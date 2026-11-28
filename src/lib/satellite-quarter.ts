import { z } from "zod";
import { seoToday } from "./seo-date-range";
import { growthLogicalTargetIdSchema } from "./growth-target-id-schema";
import type { GrowthStrategy } from "./growth-strategy";
import { QUARTER_NEW_WORD_COUNT, QUARTER_NEW_WORD_VERSION } from "./growth-quarter-calendar";
import { isOwnedBrandKeyword } from "./keyword-market-policy";
import { quarterMembershipHash, quarterWordKey } from "./quarter-membership";
import { quarterWordResearchProblem, quarterWordResearchRowSchema } from "./quarter-word-research";
import { isSeoWorkday } from "./seo-workday";
import type { WorkflowTask } from "./seo-workflow";

export const SATELLITE_QUARTER_COUNT = 200;
export const SATELLITE_QUARTER_VERSION = "satellite-quarter-v1";
export const SATELLITE_QUARTER_EXTENSION_VERSION = "satellite-quarter-v2";
const MAX_MODELFIT_WORDS = 320;
export const SATELLITE_QUARTER_SITES = ["modelfit.cc", "rackrate.org"] as const;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().trim().min(1).max(200);
const satelliteSite = z.enum(SATELLITE_QUARTER_SITES);
export const satelliteQuarterInputRowSchema = quarterWordResearchRowSchema.extend({
  siteDomain: satelliteSite, country: z.literal("US"), language: z.literal("en"), researchDate: z.iso.date(),
});
export const satelliteQuarterCommandSchema = z.object({
  action: z.literal("apply_satellite_quarter"), requestId: z.string().regex(/^[a-zA-Z0-9:_-]{8,160}$/),
  expectedVersion: z.number().int().nonnegative(), mode: z.literal("extend").optional(),
  rows: z.array(satelliteQuarterInputRowSchema).max(MAX_MODELFIT_WORDS - 100),
}).strict().superRefine((command, ctx) => {
  if (command.mode !== "extend" && command.rows.length !== SATELLITE_QUARTER_COUNT
    || command.mode === "extend" && command.rows.some(row => row.siteDomain !== "modelfit.cc")) {
    ctx.addIssue({ code: "custom", path: ["rows"], message: "原补充批次须200词；扩展仅追加ModelFit原词并保留已有两站原词" });
  }
});
export type SatelliteQuarterCommand = z.infer<typeof satelliteQuarterCommandSchema>;

const satelliteMemberSchema = satelliteQuarterInputRowSchema.omit({ excerpt: true }).extend({
  targetId: growthLogicalTargetIdSchema, keywordId: id,
});
const satelliteStoredFields = {
  version: z.enum([SATELLITE_QUARTER_VERSION, SATELLITE_QUARTER_EXTENSION_VERSION]), requestId: id, baselinePlanHash: sha256,
  selectionHash: sha256, members: z.array(satelliteMemberSchema).min(SATELLITE_QUARTER_COUNT).max(MAX_MODELFIT_WORDS + 100),
};
export const satelliteQuarterStoredSchema = z.discriminatedUnion("actor", [
  z.strictObject({ ...satelliteStoredFields, actor: z.literal("human"), approvedAt: z.iso.datetime({ offset: true }) }),
  z.strictObject({ ...satelliteStoredFields, actor: z.literal("collector"), appliedAt: z.iso.datetime({ offset: true }) }),
]).superRefine((pool, ctx) => {
  if (pool.version === SATELLITE_QUARTER_VERSION && pool.members.length !== SATELLITE_QUARTER_COUNT
    || pool.version === SATELLITE_QUARTER_EXTENSION_VERSION && pool.members.filter(row => row.siteDomain === "modelfit.cc").length > MAX_MODELFIT_WORDS) {
    ctx.addIssue({ code: "custom", path: ["members"], message: "补充词读回数量超出对应版本范围" });
  }
});
export type SatelliteQuarter = z.infer<typeof satelliteQuarterStoredSchema>;
export type SatelliteQuarterMember = SatelliteQuarter["members"][number];

export function satelliteQuarterAppliedAt(pool: SatelliteQuarter) {
  return pool.actor === "collector" ? pool.appliedAt : pool.approvedAt;
}

export function satelliteQuarterProblem(command: SatelliteQuarterCommand, strategy: GrowthStrategy, now: Date) {
  const baseline = strategy.baseline;
  const planning = strategy.quarterPlanning;
  const ids = new Set(baseline?.targets.map(target => target.id));
  if (!baseline?.planHash || baseline.targets.length !== QUARTER_NEW_WORD_COUNT || baseline.targets.some(target => target.site !== "flatkey.ai")
    || ids.size !== QUARTER_NEW_WORD_COUNT || planning?.hash !== baseline.planHash || planning.approval?.hash !== baseline.planHash
    || planning.plan.version !== QUARTER_NEW_WORD_VERSION || planning.plan.targetIds.length !== ids.size
    || planning.plan.targetIds.some(id => !ids.has(id))) {
    return "两站补充批次须绑定当前已批准冻结的 Flatkey 1,000 词原计划";
  }
  const words = new Set(baseline.targets.map(target => quarterWordKey(target.keyword)));
  if (words.size !== QUARTER_NEW_WORD_COUNT) return "Flatkey 原季度词清单的原词数量未对平";
  const sources = new Set(planning.plan.calendar?.map(row => `${row.ahrefs.sourceSha256}:${row.ahrefs.sourceRow}`));
  const today = seoToday(now);
  const sites = new Set<string>();
  if (command.mode === "extend") {
    const prior = strategy.satelliteQuarter;
    if (!prior || (!command.rows.length && prior.baselinePlanHash === baseline.planHash)
      || prior.members.filter(row => row.siteDomain === "modelfit.cc").length + command.rows.length > MAX_MODELFIT_WORDS) {
      return "扩展须追加已核ModelFit原词、或将原两站批次绑定新的Flatkey冻结版本";
    }
    for (const row of prior.members) {
      const word = quarterWordKey(row.keyword), source = `${row.sourceSha256}:${row.sourceRow}`;
      if (words.has(word) || sources.has(source)) return `${row.keyword}：原两站季度词或证据与新冻结词冲突`;
      words.add(word);
      sources.add(source);
      sites.add(row.siteDomain);
    }
  }
  for (const row of command.rows) {
    const sourceIssue = quarterWordResearchProblem(row, now);
    if (sourceIssue) return `${row.keyword}：${sourceIssue}`;
    if (isOwnedBrandKeyword(row.keyword)) return `${row.keyword}：排除自有品牌导航词`;
    const word = quarterWordKey(row.keyword);
    const source = `${row.sourceSha256}:${row.sourceRow}`;
    if (words.has(word) || sources.has(source)) return `${row.keyword}：原词或证据行与冻结原词或本批重复`;
    if (row.researchDate < planning.plan.executionStart || row.researchDate < today || row.researchDate > planning.plan.executionEnd
      || !isSeoWorkday(new Date(`${row.researchDate}T12:00:00+08:00`))) {
      return `${row.keyword}：研究日期须位于本期未来真实工作日`;
    }
    words.add(word);
    sources.add(source);
    sites.add(row.siteDomain);
  }
  return sites.size === SATELLITE_QUARTER_SITES.length ? null : "补充批次须涵盖 ModelFit 和 RackRate 两站";
}

export function satelliteQuarterBound(strategy: GrowthStrategy) {
  const pool = strategy.satelliteQuarter;
  return pool && strategy.baseline?.planHash === pool.baselinePlanHash ? pool : null;
}

export function satelliteProductionTask(task: Pick<WorkflowTask, "siteDomain" | "kind">) {
  return task.siteDomain === "modelfit.cc" && ["blog", "landing"].includes(task.kind)
    || task.siteDomain === "rackrate.org" && task.kind === "landing";
}

export function satelliteQuarterTaskMember(task: WorkflowTask, pool: SatelliteQuarter) {
  if (!satelliteProductionTask(task) || !task.keyword || !task.keywordId) return undefined;
  return pool.members.find(row => row.siteDomain === task.siteDomain && row.topicId === task.topicId
    && row.keywordId === task.keywordId && quarterWordKey(row.keyword) === quarterWordKey(task.keyword!)
    && row.country === task.country && row.language === task.language);
}

export function satelliteQuarterCounts(pool: SatelliteQuarter) {
  return Object.fromEntries(SATELLITE_QUARTER_SITES.map(site => [site, pool.members.filter(row => row.siteDomain === site).length]));
}

export function satelliteQuarterHash(rows: SatelliteQuarterCommand["rows"]) {
  return quarterMembershipHash([...rows].sort((left, right) => left.siteDomain.localeCompare(right.siteDomain)
    || quarterWordKey(left.keyword).localeCompare(quarterWordKey(right.keyword))));
}
