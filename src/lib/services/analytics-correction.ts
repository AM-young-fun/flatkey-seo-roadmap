import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { analyticsCorrectionSchema, analyticsHash, prepareAnalyticsCorrection, AnalyticsCorrectionConflict } from "../analytics-correction";
import { analyticsStorageKind } from "../seo-analytics";
import { clusterDomainForProperty } from "../seo-cluster-sites";
import { propertyToday } from "../seo-date-range";
export async function correctAnalytics(input: unknown) {
  const command = analyticsCorrectionSchema.parse(input), requestHash = analyticsHash(command);
  return prisma.$transaction(async tx => {
    const replay = await tx.seoWorkflowEvent.findUnique({ where: { requestId: command.requestId } });
    if (replay) {
      if (replay.requestHash !== requestHash || replay.kind !== "analytics-correction") throw new AnalyticsCorrectionConflict("request_id_reused");
      return { stored: false, replay: true, audit: replay };
    }
    const kind = command.action === "revise_gsc_quality" ? command.kind : analyticsStorageKind(command.observation.kind, command.observation.country, clusterDomainForProperty(command.observation.property));
    const date = command.action === "revise_gsc_quality" ? command.date : command.observation.date;
    if (date >= propertyToday() || command.action === "create_missing_ga4" && Date.parse(command.observation.observedAt) > Date.now() + 300000) throw new Error("Invalid correction date");
    // Serialize corrections with ordinary SQL imports against the same archive row.
    await tx.$queryRaw`SELECT "kind" FROM "SeoAnalyticsDay" WHERE "kind"=${kind} AND "date"=${date} FOR UPDATE`;
    const before = await tx.seoAnalyticsDay.findUnique({ where: { kind_date: { kind, date } } });
    const after = prepareAnalyticsCorrection(command, before);
    if (command.action === "create_missing_ga4") {
      const result = await tx.seoAnalyticsDay.createMany({ data: [{ ...after, payload: after.payload as Prisma.InputJsonValue }], skipDuplicates: true });
      if (result.count !== 1) throw new AnalyticsCorrectionConflict("archive_already_exists");
    } else {
      await tx.seoAnalyticsDay.update({ where: { kind_date: { kind, date } }, data: { complete: false, payload: after.payload as Prisma.InputJsonValue } });
    }
    const recordKey = `analytics-correction:${kind}:${date}`;
    const previous = await tx.seoWorkflowEvent.findFirst({ where: { recordKey }, orderBy: { version: "desc" } });
    const audit = await tx.seoWorkflowEvent.create({ data: { requestId: command.requestId, requestHash, recordKey, kind: "analytics-correction", version: (previous?.version ?? 0) + 1,
      payload: { action: command.action, reason: command.reason, evidenceHash: command.evidenceHash, actor: "authenticated-import-token", before: before ? { complete: before.complete, observedAt: before.observedAt.toISOString(), payloadHash: analyticsHash(before.payload) } : null,
        after: { complete: after.complete, observedAt: after.observedAt.toISOString(), payloadHash: analyticsHash(after.payload) }, correctedAt: new Date().toISOString() } } });
    return { stored: true, replay: false, audit };
  });
}
