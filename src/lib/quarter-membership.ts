import { createHash } from "node:crypto";
import { z } from "zod";
import { isGrowthTopicPlaceholder } from "./seo-growth-markets";

export const QUARTER_MEMBERSHIP_STATUS = "QUARTER_MEMBERSHIP_APPLIED";
export const QUARTER_NEW_MEMBERSHIP_STATUS = "QUARTER_NEW_WORD_MEMBERSHIP_APPLIED";
export const QUARTER_NEW_MEMBERSHIP_VERSION = "quarter-membership-v2";
export function quarterMembershipStatus(version: QuarterMembershipSelection["version"]) {
  return version === QUARTER_NEW_MEMBERSHIP_VERSION ? QUARTER_NEW_MEMBERSHIP_STATUS : QUARTER_MEMBERSHIP_STATUS;
}
const hash = z.string().regex(/^[a-f0-9]{64}$/), id = z.string().trim().min(1).max(200);
export const quarterWordKey = (word: string) => word.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
export function quarterMembershipHash(value: unknown): string {
  const order = (item: unknown): unknown => item instanceof Date ? item.toISOString() : Array.isArray(item) ? item.map(order) : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, order(child)])) : item;
  return createHash("sha256").update(JSON.stringify(order(value))).digest("hex");
}
export const quarterMembershipSelectionSchema = z.object({
  version: z.enum(["quarter-membership-v1", QUARTER_NEW_MEMBERSHIP_VERSION]), quarterId: z.literal("2026-close"),
  sourceReference: z.string().min(1).max(3000), sourceHash: hash,
  members: z.array(z.object({ siteDomain: z.enum(["flatkey.ai", "rackrate.org", "modelfit.cc"]), keywordId: id, keyword: z.string().min(1).max(2000), topicId: id }).strict()).min(1000).max(4800),
}).strict().superRefine((value, ctx) => {
  const words = new Set(value.members.map(row => quarterWordKey(row.keyword))).size;
  if (value.version === QUARTER_NEW_MEMBERSHIP_VERSION ? words !== 1000 || value.members.length !== 1000 : words !== 1600)
    ctx.addIssue({ code: "custom", message: "季度清单须符合对应版本的完整唯一原词数量" });
  if (new Set(value.members.map(row => `${row.siteDomain}\u0000${row.keywordId}`)).size !== value.members.length) ctx.addIssue({ code: "custom", message: "同一站点原关键词ID不得重复" });
});
export type QuarterMembershipSelection = z.infer<typeof quarterMembershipSelectionSchema>;
export const quarterMembershipCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), requestId: id, selection: quarterMembershipSelectionSchema, selectionHash: hash.optional() }).strict(),
  z.object({ action: z.literal("apply"), requestId: id, selection: quarterMembershipSelectionSchema, selectionHash: hash, expectedStateHash: hash }).strict(),
]);
export type QuarterMembershipCommand = z.infer<typeof quarterMembershipCommandSchema>;
export type QuarterMembershipRow = {
  siteDomain: string; keywordId: string; active: boolean; pool: string; topicId: string | null;
  keyword: { id: string; text: string; active: boolean };
  topicAssignments: { topicId: string }[];
  [key: string]: unknown;
};
export type QuarterMembershipTopic = { id: string; text: string; active: boolean; sites: { siteDomain: string }[]; [key: string]: unknown };
export class QuarterMembershipError extends Error { constructor(public code: string, message: string, public status = 409) { super(message); } }
export function canonicalQuarterSelection(selection: QuarterMembershipSelection) {
  return { ...selection, members: [...selection.members].sort((a, b) => a.siteDomain.localeCompare(b.siteDomain) || a.keywordId.localeCompare(b.keywordId)) };
}
/** Only the selected identities are examined; no unselected pool is demoted. */
export function planQuarterMembership(command: QuarterMembershipCommand, rows: QuarterMembershipRow[], topics: QuarterMembershipTopic[]) {
  const selection = canonicalQuarterSelection(command.selection), selectionHash = quarterMembershipHash(selection);
  if (command.selectionHash && command.selectionHash !== selectionHash) throw new QuarterMembershipError("selection_changed", "确切季度清单哈希不匹配，请重新预览");
  const ordered = [...rows].sort((a, b) => a.siteDomain.localeCompare(b.siteDomain) || a.keywordId.localeCompare(b.keywordId));
  const selectedTopics = [...topics].sort((a, b) => a.id.localeCompare(b.id));
  for (const member of selection.members) {
    const row = ordered.find(row => row.siteDomain === member.siteDomain && row.keywordId === member.keywordId);
    const topic = selectedTopics.find(topic => topic.id === member.topicId);
    if (!row || row.keyword.id !== member.keywordId || quarterWordKey(row.keyword.text) !== quarterWordKey(member.keyword)) throw new QuarterMembershipError("identity_changed", "原词ID、原文或本站成员已变化");
    if (!row.active || !row.keyword.active || !["FORMAL", "RESEARCH"].includes(row.pool)) throw new QuarterMembershipError("inactive_member", "停用、归档或归并记录不能由季度规划复活");
    if (!topic?.active || isGrowthTopicPlaceholder(topic.text) || !topic.sites.some(site => site.siteDomain === member.siteDomain) || row.topicId !== member.topicId && !row.topicAssignments.some(edge => edge.topicId === member.topicId)) throw new QuarterMembershipError("topic_relation_missing", "须沿本站真实有效TopicMap原关系纳入，不能借占位话题或临时挂词");
  }
  const stateHash = quarterMembershipHash({ selectionHash, rows: ordered, topics: selectedTopics });
  if (command.action === "apply" && command.expectedStateHash !== stateHash) throw new QuarterMembershipError("state_changed", "预览后原词、话题或成员状态已变化，请重新预览");
  return { selection, selectionHash, stateHash, before: ordered, topics: selectedTopics, changes: ordered.filter(row => row.pool === "RESEARCH").map(row => ({ siteDomain: row.siteDomain, keywordId: row.keywordId, from: row.pool, to: "FORMAL" as const })), uniqueWords: new Set(selection.members.map(row => quarterWordKey(row.keyword))).size, membershipCount: selection.members.length };
}
