import { canonicalQuarterSelection, planQuarterMembership, quarterMembershipCommandSchema, quarterMembershipHash,
  quarterMembershipSelectionSchema, quarterWordKey, quarterMembershipStatus,
  type QuarterMembershipRow, type QuarterMembershipSelection, type QuarterMembershipTopic } from "./quarter-membership";
import { isGrowthTopicPlaceholder } from "./seo-growth-markets";
import type { GrowthWorkspaceInput } from "./growth-workspace";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const sha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const memberKey = (site: string, keywordId: string) => `${site}\u0000${keywordId}`;
export type AppliedQuarterManifest = {
  auditId: string; selection: QuarterMembershipSelection; selectionHash: string; requestId: string;
  afterHash: string; sourceHash: string; expectedStateHash: string; changed: number;
  uniqueWords: number; membershipCount: number; actor: "human"; appliedAt: string;
  afterMembers: QuarterMembershipRow[];
};

/** Authority comes only from a committed human apply audit. A preview, caller
 * manifest, changed receipt or partial 1600 list is never a source of truth. */
export function readAppliedQuarterManifestAudit(raw: unknown): AppliedQuarterManifest | null {
  try {
    const audit = object(raw), summary = object(audit.summary), before = object(audit.before), after = object(audit.after);
    if (audit.siteDomain !== "flatkey.ai" || audit.restoredAt != null
      || summary.actor !== "human" || typeof summary.requestId !== "string"
      || audit.id !== `quarter-membership:2026-close:${summary.requestId}` || !sha(audit.payloadHash)
      || !sha(summary.selectionHash) || !sha(summary.sourceHash) || !sha(summary.expectedStateHash) || !sha(summary.afterHash)
      || !Number.isInteger(summary.changed) || Number(summary.changed) < 0
      || !Array.isArray(before.members) || !Array.isArray(before.topics) || !Array.isArray(after.members) || !Array.isArray(after.topics)
      || Object.keys(before).sort().join() !== "members,topics" || Object.keys(after).sort().join() !== "members,topics") return null;
    const appliedAt = audit.appliedAt instanceof Date ? audit.appliedAt.toISOString() : audit.appliedAt;
    if (typeof appliedAt !== "string" || !Number.isFinite(Date.parse(appliedAt))) return null;
    const selection = canonicalQuarterSelection(quarterMembershipSelectionSchema.parse(summary.selection));
    if (audit.status !== quarterMembershipStatus(selection.version) || summary.version !== selection.version
      || quarterMembershipHash(selection) !== summary.selectionHash || selection.sourceHash !== summary.sourceHash
      || summary.membershipCount !== selection.members.length) return null;
    const command = quarterMembershipCommandSchema.parse({ action: "apply", requestId: summary.requestId,
      selection, selectionHash: summary.selectionHash, expectedStateHash: summary.expectedStateHash });
    // Legacy noncanonical input order was not retained by the old service. Do
    // not guess that order or grant authority when its command hash cannot be rebuilt.
    if (quarterMembershipHash(command) !== audit.payloadHash) return null;
    const members = before.members as QuarterMembershipRow[], topics = before.topics as QuarterMembershipTopic[];
    const selectedKeys = new Set(selection.members.map(row => memberKey(row.siteDomain, row.keywordId)));
    const topicIds = new Set(selection.members.map(row => row.topicId));
    if (members.length !== selectedKeys.size || new Set(members.map(row => memberKey(row.siteDomain, row.keywordId))).size !== selectedKeys.size
      || members.some(row => !selectedKeys.has(memberKey(row.siteDomain, row.keywordId)))
      || topics.length !== topicIds.size || new Set(topics.map(row => row.id)).size !== topicIds.size || topics.some(row => !topicIds.has(row.id))) return null;
    const plan = planQuarterMembership(command, members, topics);
    const expectedMembers = plan.before.map(row => ({ ...row, pool: "FORMAL" }));
    if (summary.uniqueWords !== plan.uniqueWords || summary.changed !== plan.changes.length || quarterMembershipHash(before) !== quarterMembershipHash({ members: plan.before, topics: plan.topics })
      || quarterMembershipHash(after) !== quarterMembershipHash({ members: expectedMembers, topics: plan.topics })
      || quarterMembershipHash(after.members) !== summary.afterHash) return null;
    return { auditId: String(audit.id), selection, selectionHash: summary.selectionHash, requestId: summary.requestId,
      afterHash: summary.afterHash, sourceHash: summary.sourceHash, expectedStateHash: summary.expectedStateHash,
      changed: Number(summary.changed), uniqueWords: plan.uniqueWords, membershipCount: selection.members.length, actor: "human", appliedAt,
      afterMembers: after.members as QuarterMembershipRow[] };
  } catch { return null; }
}

export type CurrentQuarterTopicProjection = {
  scope: "current-quarter-only"; site: string; keywordId: string; keyword: string;
  originalTopicId: string | null; topicId: string; auditId: string; selectionHash: string; sourceHash: string;
};
/** Changes only an in-memory current-topic preference, preserving the stored
 * primary and every old edge in provenance. Rank facts and period cohorts do
 * not participate and remain the same objects passed to the normal builder. */
export function projectAppliedQuarterManifestTopics(input: GrowthWorkspaceInput, rawAudit: unknown,
  sites: readonly { domain: string; active: boolean }[]) {
  const applied = readAppliedQuarterManifestAudit(rawAudit), projections: CurrentQuarterTopicProjection[] = [];
  const asOf = Date.parse(input.generatedAt);
  if (!applied || !Number.isFinite(asOf) || Date.parse(applied.appliedAt) > asOf) {
    return { input, applied: null, projections, skipped: 0 };
  }
  const selected = new Map(applied.selection.members.map(row => [memberKey(row.siteDomain, row.keywordId), row]));
  const approvedMembers = new Map(applied.afterMembers.map(row => [memberKey(row.siteDomain, row.keywordId), row]));
  const activeSites = new Set(sites.filter(site => site.active).map(site => site.domain));
  const topics = new Map(input.topics.map(topic => [topic.id, topic]));
  let skipped = 0;
  const memberships = input.memberships.map(row => {
    const key = memberKey(row.site, row.keywordId), member = selected.get(key), approved = approvedMembers.get(key);
    if (!member) return row;
    const topic = topics.get(member.topicId);
    if (!approved || approved.keyword.text !== row.keyword || quarterWordKey(row.keyword) !== quarterWordKey(member.keyword)
      || !activeSites.has(row.site) || !row.active || !row.keywordActive || row.pool !== "FORMAL"
      || !topic?.active || isGrowthTopicPlaceholder(topic.text) || !topic.sites.includes(row.site)
      || row.topicId !== member.topicId && !row.topicIds?.includes(member.topicId)) { skipped++; return row; }
    projections.push({ scope: "current-quarter-only", site: row.site, keywordId: row.keywordId, keyword: row.keyword,
      originalTopicId: row.topicId, topicId: member.topicId, auditId: applied.auditId,
      selectionHash: applied.selectionHash, sourceHash: applied.sourceHash });
    return { ...row, topicId: member.topicId,
      topicIds: [...new Set([...(row.topicId ? [row.topicId] : []), ...(row.topicIds ?? [])])] };
  });
  return { input: { ...input, memberships }, applied, projections, skipped };
}
