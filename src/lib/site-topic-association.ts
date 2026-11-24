import { createHash } from "node:crypto";
import { z } from "zod";
import { GROWTH_EXECUTION_SITES, isGrowthTopicPlaceholder } from "./seo-growth-markets";
import { WorkflowError, type WorkflowActor } from "./seo-workflow-state";

const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/u);
export const associationRequestIdSchema = z.string().min(8).max(180).regex(/^[A-Za-z0-9][A-Za-z0-9:._-]+$/u);
export const topicAssociationIdentitySchema = z.object({
  siteDomain: z.enum(GROWTH_EXECUTION_SITES), keywordId: id,
  keyword: z.string().min(1).max(500).refine(value => Boolean(value.trim()), "缺少原关键词"), topicId: id,
}).strict();
export const addTopicAssociationSchema = topicAssociationIdentitySchema.extend({
  action: z.literal("add"), requestId: associationRequestIdSchema,
  expectedStateHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type TopicAssociationIdentity = z.infer<typeof topicAssociationIdentitySchema>;
export type AddTopicAssociation = z.infer<typeof addTopicAssociationSchema>;
type Row = Record<string, unknown>;
export type TopicAssociationState = {
  site: Row | null; keyword: Row | null; member: Row | null;
  topic: Row | null; siteTopic: Row | null; assignments: Row[];
};
export const TOPIC_ASSOCIATION_AUDIT_STATUS = "SITE_TOPIC_ASSOCIATION_V1";
export const associationAuditId = (requestId: string) => `site-topic-association:${requestId}`;
export const associationCanonical = (value: unknown) => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const associationHash = (value: unknown) => createHash("sha256").update(associationCanonical(value)).digest("hex");
/** Normalize DB Date values and edge order only. Protected array order is retained. */
export function canonicalAssociationState(state: TopicAssociationState): TopicAssociationState {
  const result = JSON.parse(JSON.stringify(state)) as TopicAssociationState;
  result.assignments.sort((a, b) => associationCanonical(a).localeCompare(associationCanonical(b)));
  return result;
}
export function requireAssociationHuman(actor: WorkflowActor) {
  if (actor !== "human") throw new WorkflowError("human_topic_association_required", "仅接受已登录用户的本站话题关联操作，采集器不能修改关联", 403);
}
export function validateTopicAssociationState(state: TopicAssociationState, identity: TopicAssociationIdentity) {
  const { site, keyword, member, topic, siteTopic } = state;
  if (!site || site.domain !== identity.siteDomain || !keyword || keyword.id !== identity.keywordId
    || keyword.text !== identity.keyword || !member || member.siteDomain !== identity.siteDomain || member.keywordId !== identity.keywordId) {
    throw new WorkflowError("association_member_missing", "原词、原ID或本站成员不匹配，不创建或替换成员", 404);
  }
  if (!topic || topic.id !== identity.topicId || !siteTopic || siteTopic.siteDomain !== identity.siteDomain || siteTopic.topicId !== identity.topicId) {
    throw new WorkflowError("association_topic_not_in_site", "目标话题不属于本站，不自动跨站共享话题", 422);
  }
  if (site.active !== true || keyword.active !== true || member.active !== true || topic.active !== true) {
    throw new WorkflowError("association_inactive_source", "站点、原词、本站成员和目标话题必须均为启用状态", 422);
  }
  if (typeof topic.text !== "string" || isGrowthTopicPlaceholder(topic.text)
    || /^(?:候选(?:词|关键词|话题)?(?:容器|池)?|研究候选(?:容器|池)?|research backlog|candidate(?:s)?(?: pool| container)?)$/iu.test(topic.text.trim())) {
    throw new WorkflowError("association_placeholder_topic", "不能将候选容器或占位话题录用为真实话题", 422);
  }
  if (state.assignments.some(edge => edge.siteDomain !== identity.siteDomain || edge.keywordId !== identity.keywordId)) {
    throw new WorkflowError("association_scope_mismatch", "原关联包含其他站点或关键词，拒绝写入", 409);
  }
}
export function previewTopicAssociation(raw: unknown, state: TopicAssociationState, actor: WorkflowActor) {
  requireAssociationHuman(actor);
  const identity = topicAssociationIdentitySchema.parse(raw), before = canonicalAssociationState(state);
  validateTopicAssociationState(before, identity);
  return { identity, state: before, stateHash: associationHash(before),
    edgeExists: before.assignments.some(edge => edge.topicId === identity.topicId) };
}
/** No pool promotion, primary-parent rewrite, edge removal or task mutation. */
export function prepareTopicAssociation(raw: unknown, state: TopicAssociationState, actor: WorkflowActor) {
  requireAssociationHuman(actor);
  const command = addTopicAssociationSchema.parse(raw), before = canonicalAssociationState(state);
  const beforeHash = associationHash(before);
  if (beforeHash !== command.expectedStateHash) throw new WorkflowError("association_state_changed", "预览后原词、成员、话题或关联已变化，请重读预览；未写入", 409);
  validateTopicAssociationState(before, command);
  const edge = { siteDomain: command.siteDomain, keywordId: command.keywordId, topicId: command.topicId };
  const createdEdge = !before.assignments.some(row => row.topicId === command.topicId);
  const after = canonicalAssociationState({ ...before, assignments: createdEdge ? [...before.assignments, edge] : before.assignments });
  return { command, before, beforeHash, after, afterHash: associationHash(after), edge, createdEdge };
}
