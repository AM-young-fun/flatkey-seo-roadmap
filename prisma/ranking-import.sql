-- Additive, idempotent migration for existing production databases (PostgreSQL 12+).
BEGIN;
SET LOCAL lock_timeout = '15s';
SELECT pg_advisory_xact_lock(hashtext('flatkey-ranking-import-v1'));
ALTER TYPE "RankBucket" ADD VALUE IF NOT EXISTS 'TOP_30';
ALTER TYPE "RankBucket" ADD VALUE IF NOT EXISTS 'TOP_100';

-- CreateTable
CREATE TABLE IF NOT EXISTS "RankingImport" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankingImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "KeywordObservation" (
    "id" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "region" "SearchRegion" NOT NULL,
    "rank" DOUBLE PRECISION,
    "rankReported" BOOLEAN NOT NULL DEFAULT false,
    "volume" INTEGER,
    "clicks" INTEGER,
    "impressions" INTEGER,
    "ctr" DOUBLE PRECISION,
    "periodStart" DATE,
    "periodEnd" DATE,
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeywordObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RankingImport_requestId_key" ON "RankingImport"("requestId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "KeywordObservation_keywordId_region_source_collectedAt_idx" ON "KeywordObservation"("keywordId", "region", "source", "collectedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "KeywordObservation_keywordId_region_collectedAt_importedAt_idx" ON "KeywordObservation"("keywordId", "region", "collectedAt" DESC, "importedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "KeywordObservation_importId_keywordId_region_source_key" ON "KeywordObservation"("importId", "keywordId", "region", "source");

-- AddForeignKey, guarded for repeat production builds
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KeywordObservation_keywordId_fkey' AND conrelid = '"KeywordObservation"'::regclass) THEN
        ALTER TABLE "KeywordObservation" ADD CONSTRAINT "KeywordObservation_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KeywordObservation_importId_fkey' AND conrelid = '"KeywordObservation"'::regclass) THEN
        ALTER TABLE "KeywordObservation" ADD CONSTRAINT "KeywordObservation_importId_fkey" FOREIGN KEY ("importId") REFERENCES "RankingImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AlterTable
ALTER TABLE "RankingImport" ADD COLUMN IF NOT EXISTS "siteDomain" TEXT;

-- AlterTable
ALTER TABLE "KeywordObservation" ADD COLUMN IF NOT EXISTS "captureId" TEXT,
ADD COLUMN IF NOT EXISTS "dataUpdatedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "rankStatus" TEXT NOT NULL DEFAULT 'no_data',
ADD COLUMN IF NOT EXISTS "siteDomain" TEXT,
ADD COLUMN IF NOT EXISTS "url" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "SeoSite" (
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "ga4PropertyId" TEXT,
    "initializedAt" TIMESTAMP(3),

    CONSTRAINT "SeoSite_pkey" PRIMARY KEY ("domain")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SiteTopic" (
    "siteDomain" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,

    CONSTRAINT "SiteTopic_pkey" PRIMARY KEY ("siteDomain","topicId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SiteKeyword" (
    "siteDomain" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "topicId" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'PLANNED',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "targetUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteKeyword_pkey" PRIMARY KEY ("siteDomain","keywordId")
);

-- Keep the source observation date separate from collection/import time.
-- Existing rows stay undated: upload time cannot establish 60-day demand history.
ALTER TABLE "KeywordVolume" ADD COLUMN IF NOT EXISTS "observedAt" TIMESTAMP(3);
ALTER TABLE "SiteKeyword" ADD COLUMN IF NOT EXISTS "exclusionReason" TEXT,
ADD COLUMN IF NOT EXISTS "excludedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "restoredAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SiteKeywordTopic" (
    "siteDomain" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,

    CONSTRAINT "SiteKeywordTopic_pkey" PRIMARY KEY ("siteDomain","keywordId","topicId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RankingCapture" (
    "id" TEXT NOT NULL,
    "siteDomain" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "region" "SearchRegion" NOT NULL,
    "captureDate" DATE NOT NULL,
    "coverage" TEXT NOT NULL DEFAULT 'tracked',
    "status" TEXT NOT NULL DEFAULT 'PARTIAL',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RankingCapture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "KeywordPageObservation" (
    "id" TEXT NOT NULL,
    "siteDomain" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "region" "SearchRegion" NOT NULL,
    "source" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "rank" DOUBLE PRECISION,
    "clicks" INTEGER,
    "impressions" INTEGER,
    "ctr" DOUBLE PRECISION,
    "periodStart" DATE,
    "periodEnd" DATE,
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "dataUpdatedAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeywordPageObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WeeklyTraffic" (
    "id" TEXT NOT NULL,
    "siteDomain" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "newUsers" INTEGER NOT NULL,
    "newRegistrations" INTEGER NOT NULL,
    "ga4PropertyId" TEXT,
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyTraffic_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SiteKeyword_siteDomain_active_idx" ON "SiteKeyword"("siteDomain", "active");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RankingCapture_siteDomain_region_source_captureDate_idx" ON "RankingCapture"("siteDomain", "region", "source", "captureDate" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "KeywordPageObservation_siteDomain_keywordId_region_source_c_idx" ON "KeywordPageObservation"("siteDomain", "keywordId", "region", "source", "collectedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "KeywordPageObservation_importId_keywordId_region_source_url_key" ON "KeywordPageObservation"("importId", "keywordId", "region", "source", "url");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WeeklyTraffic_siteDomain_periodStart_periodEnd_collectedAt_idx" ON "WeeklyTraffic"("siteDomain", "periodStart", "periodEnd", "collectedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WeeklyTraffic_importId_periodStart_periodEnd_key" ON "WeeklyTraffic"("importId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "KeywordObservation_siteDomain_keywordId_region_source_colle_idx" ON "KeywordObservation"("siteDomain", "keywordId", "region", "source", "collectedAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "KeywordObservation_captureId_idx" ON "KeywordObservation"("captureId");

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RankingImport_siteDomain_fkey') THEN ALTER TABLE "RankingImport" ADD CONSTRAINT "RankingImport_siteDomain_fkey" FOREIGN KEY ("siteDomain") REFERENCES "SeoSite"("domain") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KeywordObservation_siteDomain_fkey') THEN ALTER TABLE "KeywordObservation" ADD CONSTRAINT "KeywordObservation_siteDomain_fkey" FOREIGN KEY ("siteDomain") REFERENCES "SeoSite"("domain") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KeywordObservation_captureId_fkey') THEN ALTER TABLE "KeywordObservation" ADD CONSTRAINT "KeywordObservation_captureId_fkey" FOREIGN KEY ("captureId") REFERENCES "RankingCapture"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SiteTopic_siteDomain_fkey') THEN ALTER TABLE "SiteTopic" ADD CONSTRAINT "SiteTopic_siteDomain_fkey" FOREIGN KEY ("siteDomain") REFERENCES "SeoSite"("domain") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SiteTopic_topicId_fkey') THEN ALTER TABLE "SiteTopic" ADD CONSTRAINT "SiteTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SiteKeyword_siteDomain_fkey') THEN ALTER TABLE "SiteKeyword" ADD CONSTRAINT "SiteKeyword_siteDomain_fkey" FOREIGN KEY ("siteDomain") REFERENCES "SeoSite"("domain") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SiteKeyword_keywordId_fkey') THEN ALTER TABLE "SiteKeyword" ADD CONSTRAINT "SiteKeyword_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SiteKeyword_topicId_fkey') THEN ALTER TABLE "SiteKeyword" ADD CONSTRAINT "SiteKeyword_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SiteKeywordTopic_siteDomain_keywordId_fkey') THEN ALTER TABLE "SiteKeywordTopic" ADD CONSTRAINT "SiteKeywordTopic_siteDomain_keywordId_fkey" FOREIGN KEY ("siteDomain", "keywordId") REFERENCES "SiteKeyword"("siteDomain", "keywordId") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SiteKeywordTopic_topicId_fkey') THEN ALTER TABLE "SiteKeywordTopic" ADD CONSTRAINT "SiteKeywordTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RankingCapture_siteDomain_fkey') THEN ALTER TABLE "RankingCapture" ADD CONSTRAINT "RankingCapture_siteDomain_fkey" FOREIGN KEY ("siteDomain") REFERENCES "SeoSite"("domain") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KeywordPageObservation_siteDomain_fkey') THEN ALTER TABLE "KeywordPageObservation" ADD CONSTRAINT "KeywordPageObservation_siteDomain_fkey" FOREIGN KEY ("siteDomain") REFERENCES "SeoSite"("domain") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KeywordPageObservation_keywordId_fkey') THEN ALTER TABLE "KeywordPageObservation" ADD CONSTRAINT "KeywordPageObservation_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KeywordPageObservation_importId_fkey') THEN ALTER TABLE "KeywordPageObservation" ADD CONSTRAINT "KeywordPageObservation_importId_fkey" FOREIGN KEY ("importId") REFERENCES "RankingImport"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WeeklyTraffic_siteDomain_fkey') THEN ALTER TABLE "WeeklyTraffic" ADD CONSTRAINT "WeeklyTraffic_siteDomain_fkey" FOREIGN KEY ("siteDomain") REFERENCES "SeoSite"("domain") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WeeklyTraffic_importId_fkey') THEN ALTER TABLE "WeeklyTraffic" ADD CONSTRAINT "WeeklyTraffic_importId_fkey" FOREIGN KEY ("importId") REFERENCES "RankingImport"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;


INSERT INTO "SeoSite" ("domain", "name", "ga4PropertyId") VALUES
 ('flatkey.ai', 'Flatkey', NULL), ('rackrate.org', 'RackRate', '558899190'), ('modelfit.cc', 'ModelFit', '558978062') ON CONFLICT ("domain") DO NOTHING;
INSERT INTO "SiteTopic" ("siteDomain", "topicId") SELECT 'flatkey.ai', "id" FROM "Topic" WHERE (SELECT "initializedAt" IS NULL FROM "SeoSite" WHERE "domain" = 'flatkey.ai') ON CONFLICT DO NOTHING;
INSERT INTO "SiteKeyword" ("siteDomain", "keywordId", "topicId") SELECT 'flatkey.ai', "id", "topicId" FROM "Keyword" WHERE (SELECT "initializedAt" IS NULL FROM "SeoSite" WHERE "domain" = 'flatkey.ai') ON CONFLICT DO NOTHING;
UPDATE "KeywordObservation" SET "siteDomain" = 'flatkey.ai', "rankStatus" = CASE WHEN "rank" <= 100 THEN 'ranked' WHEN "rank" > 100 THEN 'outside_top100' ELSE 'no_data' END WHERE "siteDomain" IS NULL;
UPDATE "RankingImport" SET "siteDomain" = 'flatkey.ai' WHERE "siteDomain" IS NULL;
UPDATE "SeoSite" SET "initializedAt" = NOW() WHERE "domain" = 'flatkey.ai' AND "initializedAt" IS NULL;

ALTER TABLE "WeeklyTraffic" ADD COLUMN IF NOT EXISTS "registrationMetric" TEXT NOT NULL DEFAULT 'sign_up_distinct_users';
CREATE TABLE IF NOT EXISTS "DailyRankingReport" (
 "id" TEXT PRIMARY KEY, "siteDomain" TEXT NOT NULL REFERENCES "SeoSite"("domain"),
 "importId" TEXT NOT NULL REFERENCES "RankingImport"("id") ON DELETE CASCADE,
 "date" DATE NOT NULL, "publishedWeek" DATE, "region" "SearchRegion" NOT NULL, "source" TEXT NOT NULL,
 "top10" INTEGER NOT NULL, "top30" INTEGER NOT NULL, "top50" INTEGER NOT NULL, "top100" INTEGER NOT NULL,
 "totalKeywords" INTEGER NOT NULL, "rankings" JSONB NOT NULL, "sourceUrl" TEXT NOT NULL,
 "collectedAt" TIMESTAMP(3) NOT NULL, "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("importId", "date", "region", "source")
);
CREATE INDEX IF NOT EXISTS "DailyRankingReport_region_date_siteDomain_source_collectedAt_idx" ON "DailyRankingReport"("region", "date", "siteDomain", "source", "collectedAt" DESC);
-- Additive OKR curation metadata. Existing inventory remains research until
-- an explicit authenticated application of the bundled audit.
ALTER TABLE "SiteKeyword" ADD COLUMN IF NOT EXISTS "pool" TEXT NOT NULL DEFAULT 'RESEARCH';
ALTER TABLE "SiteKeyword" ADD COLUMN IF NOT EXISTS "reviewStatus" TEXT NOT NULL DEFAULT 'UNREVIEWED';
ALTER TABLE "SiteKeyword" ADD COLUMN IF NOT EXISTS "mappingStatus" TEXT NOT NULL DEFAULT 'UNMAPPED';
ALTER TABLE "SiteKeyword" ADD COLUMN IF NOT EXISTS "candidateUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "SiteKeyword" ADD COLUMN IF NOT EXISTS "auditReason" TEXT;
ALTER TABLE "SiteKeyword" ADD COLUMN IF NOT EXISTS "protected" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SiteKeyword" ADD COLUMN IF NOT EXISTS "curatedAt" TIMESTAMP(3);
ALTER TABLE "SiteKeyword" ADD COLUMN IF NOT EXISTS "curationId" TEXT;
CREATE INDEX IF NOT EXISTS "SiteKeyword_siteDomain_pool_idx" ON "SiteKeyword"("siteDomain", "pool");
CREATE TABLE IF NOT EXISTS "KeywordCurationAudit" (
 "id" TEXT PRIMARY KEY, "siteDomain" TEXT NOT NULL REFERENCES "SeoSite"("domain"),
 "payloadHash" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'APPLIED',
 "before" JSONB NOT NULL, "after" JSONB NOT NULL, "summary" JSONB NOT NULL,
 "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "restoredAt" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "KeywordCurationAudit_siteDomain_appliedAt_idx" ON "KeywordCurationAudit"("siteDomain", "appliedAt");
CREATE TABLE IF NOT EXISTS "KeywordContentTask" (
 "id" TEXT PRIMARY KEY, "siteDomain" TEXT NOT NULL REFERENCES "SeoSite"("domain"),
 "auditId" TEXT NOT NULL REFERENCES "KeywordCurationAudit"("id"),
 "plannedUrl" TEXT NOT NULL, "type" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'TODO',
 "title" TEXT NOT NULL, "reason" TEXT NOT NULL, "keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 "targetUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "owner" TEXT, "dueAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "KeywordContentTask_siteDomain_status_idx" ON "KeywordContentTask"("siteDomain", "status");
CREATE INDEX IF NOT EXISTS "KeywordContentTask_auditId_idx" ON "KeywordContentTask"("auditId");
-- Additive, idempotent collaborative-sheet source state. No backfill,
-- whole-inventory replacement, cleanup, or deletion is performed here.
CREATE TABLE IF NOT EXISTS "KeywordSourceRow" (
 "siteDomain" TEXT NOT NULL REFERENCES "SeoSite"("domain"), "sourceId" TEXT NOT NULL,
 "rowKey" TEXT NOT NULL, "snapshotHash" TEXT NOT NULL, "snapshot" JSONB NOT NULL,
 "observedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("siteDomain", "sourceId", "rowKey")
);
CREATE INDEX IF NOT EXISTS "KeywordSourceRow_siteDomain_sourceId_idx" ON "KeywordSourceRow"("siteDomain", "sourceId");
-- Server-side encrypted API connection and durable paid-request ledger. No
-- scheduled paid calls are enabled by this migration.
CREATE TABLE IF NOT EXISTS "DataForSeoConnection" (
 "siteDomain" TEXT PRIMARY KEY REFERENCES "SeoSite"("domain"),
 "encryptedCredentials" TEXT NOT NULL, "loginMasked" TEXT NOT NULL,
 "connectionVersion" INTEGER NOT NULL DEFAULT 1, "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "DataForSeoRun" (
 "requestId" TEXT PRIMARY KEY, "siteDomain" TEXT NOT NULL REFERENCES "SeoSite"("domain"),
 status TEXT NOT NULL DEFAULT 'PENDING', "requestHash" TEXT NOT NULL, "requestJson" JSONB NOT NULL,
 "connectionVersion" INTEGER NOT NULL, "estimatedCostMicros" INTEGER NOT NULL,
 "budgetCostMicros" INTEGER NOT NULL, "actualCostMicros" INTEGER,
 "rawResponse" TEXT, normalized JSONB, "importPayload" JSONB, candidates JSONB, summary JSONB,
 "collectedAt" TIMESTAMP(3), "errorCode" TEXT, "completedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("estimatedCostMicros" >= 0 AND "budgetCostMicros" >= 0)
);
CREATE INDEX IF NOT EXISTS "DataForSeoRun_siteDomain_createdAt_idx" ON "DataForSeoRun"("siteDomain", "createdAt" DESC);
ALTER TABLE "DataForSeoRun" ADD COLUMN IF NOT EXISTS "importPayload" JSONB;
ALTER TABLE "DataForSeoRun" ADD COLUMN IF NOT EXISTS "importedBatches" INTEGER NOT NULL DEFAULT 0;
-- SERP live monitoring is isolated from historical Labs discovery.
CREATE TABLE IF NOT EXISTS "SerpMonitorConfig" (
 id TEXT PRIMARY KEY DEFAULT 'default', region TEXT NOT NULL DEFAULT 'US',
 "languageCode" TEXT NOT NULL DEFAULT 'en', "locationCode" INTEGER NOT NULL DEFAULT 2840,
 device TEXT NOT NULL DEFAULT 'desktop', depth INTEGER NOT NULL DEFAULT 100, schedule TEXT NOT NULL DEFAULT 'SEMI_MONTHLY',
 "intervalDays" INTEGER NOT NULL DEFAULT 14, "paidEnabled" BOOLEAN NOT NULL DEFAULT false,
 "maxRunCostMicros" INTEGER NOT NULL DEFAULT 50000000, "maxMonthCostMicros" INTEGER NOT NULL DEFAULT 100000000,
 revision INTEGER NOT NULL DEFAULT 1, "nextDueAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (depth = 100 AND "intervalDays" = 14), CHECK ("maxRunCostMicros" > 0 AND "maxMonthCostMicros" > 0)
);
CREATE TABLE IF NOT EXISTS "SerpMonitorRun" (
 id TEXT PRIMARY KEY, "periodKey" TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'SCHEDULED', "sampleAuthorizationHash" TEXT, "periodLabel" TEXT NOT NULL, "periodStart" TIMESTAMP(3) NOT NULL, "periodEnd" TIMESTAMP(3) NOT NULL, status TEXT NOT NULL DEFAULT 'PLANNED',
 "cohortHash" TEXT NOT NULL, "cohortJson" JSONB NOT NULL, "configJson" JSONB NOT NULL,
 "queryCount" INTEGER NOT NULL, "targetCount" INTEGER NOT NULL,
 "estimatedCostMicros" INTEGER NOT NULL, "reservedCostMicros" INTEGER NOT NULL, "actualCostMicros" INTEGER,
 "connectionVersion" INTEGER NOT NULL, "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "completedAt" TIMESTAMP(3), "errorCode" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("estimatedCostMicros" >= 0 AND "reservedCostMicros" >= 0)
);
-- A one-off sample must not occupy or activate the scheduled full-cohort slot.
ALTER TABLE "SerpMonitorRun" ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'SCHEDULED';
ALTER TABLE "SerpMonitorRun" ADD COLUMN IF NOT EXISTS "sampleAuthorizationHash" TEXT;
ALTER TABLE "SerpMonitorRun" DROP CONSTRAINT IF EXISTS "SerpMonitorRun_periodKey_key";
DROP INDEX IF EXISTS "SerpMonitorRun_periodKey_key";
CREATE UNIQUE INDEX IF NOT EXISTS "SerpMonitorRun_periodKey_scope_key" ON "SerpMonitorRun"("periodKey", scope);
CREATE UNIQUE INDEX IF NOT EXISTS "SerpMonitorRun_sampleAuthorizationHash_key" ON "SerpMonitorRun"("sampleAuthorizationHash");
CREATE INDEX IF NOT EXISTS "SerpMonitorRun_createdAt_idx" ON "SerpMonitorRun"("createdAt" DESC);
CREATE INDEX IF NOT EXISTS "SerpMonitorRun_status_idx" ON "SerpMonitorRun"(status);
CREATE TABLE IF NOT EXISTS "SerpMonitorTask" (
 id TEXT PRIMARY KEY, "runId" TEXT NOT NULL REFERENCES "SerpMonitorRun"(id) ON DELETE RESTRICT,
 region TEXT NOT NULL DEFAULT 'US', "queryKey" TEXT NOT NULL, keyword TEXT NOT NULL, "targetsJson" JSONB NOT NULL,
 state TEXT NOT NULL DEFAULT 'PLANNED', "providerTaskId" TEXT UNIQUE, "requestJson" JSONB NOT NULL,
 "submissionRaw" TEXT, "rawResponse" TEXT, "normalizedJson" JSONB, "checkedAt" TIMESTAMP(3), "costMicros" INTEGER,
 "errorCode" TEXT, "submittedAt" TIMESTAMP(3), "lastPolledAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("runId", "queryKey")
);
ALTER TABLE "SerpMonitorTask" ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT 'US';
CREATE INDEX IF NOT EXISTS "SerpMonitorTask_region_checkedAt_idx" ON "SerpMonitorTask"(region, "checkedAt" DESC);
CREATE INDEX IF NOT EXISTS "SerpMonitorTask_runId_state_idx" ON "SerpMonitorTask"("runId", state);
CREATE INDEX IF NOT EXISTS "SerpMonitorTask_checkedAt_idx" ON "SerpMonitorTask"("checkedAt" DESC);
ALTER TABLE "WeeklyTraffic" ADD COLUMN IF NOT EXISTS "analysis" JSONB;
CREATE TABLE IF NOT EXISTS "WeeklyReportDraft" (
  "siteDomain" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "collectedAt" TIMESTAMP(3) NOT NULL,
  "payload" JSONB NOT NULL,
  PRIMARY KEY ("siteDomain", "periodStart")
);

ALTER TABLE "SerpMonitorConfig" ADD COLUMN IF NOT EXISTS "authorizationVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "SchedulerCheck" (
  id TEXT PRIMARY KEY,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  status TEXT NOT NULL DEFAULT 'RUNNING',
  "discoveryStatus" TEXT,
  "serpStatus" TEXT,
  "paidRequests" INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "SchedulerCheck_startedAt_idx" ON "SchedulerCheck" ("startedAt" DESC);

COMMIT;
