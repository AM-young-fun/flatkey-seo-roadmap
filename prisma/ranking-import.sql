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

COMMIT;
