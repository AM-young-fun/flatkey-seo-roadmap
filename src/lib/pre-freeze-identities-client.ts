import type { PreFreezeReview } from "./pre-freeze-market-identities";
import type { GrowthTarget } from "./growth-types";
import type { QuarterPlanningInput } from "./growth-quarter-planning";

export type IdentityPreview = { status: "IDENTITIES_PREVIEW"; stateHash: string; readbackHash: string; reviewHash: string; selectionHash: string;
  createSourceRows: number; results: { siteDomain: string; keywordId: string; keyword: string; topicId: string; country: string; language: string; previousCountry?: string | null; previousLanguage?: string | null; market: "create" | "reuse"; languageReview: "create" | "reuse"; targetIdAfter: string }[] };
export type IdentityApply = { action: "apply_identities"; requestId: string; expectedStateHash: string; review: PreFreezeReview };
export type IdentityReceipt = { requestId: string; actor: string; reviewHash: string; selectionHash: string; beforeHash: string; afterHash: string; results: IdentityPreview["results"]; createdSourceRows: number };
export const identityApi = "/api/keywords/quarter-membership";
export const canonicalIdentityClient = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
/** A definite rejected draft can be previewed afresh; transport uncertainty cannot. */
export function identityDraftReadback(actual: { state: { baseline?: unknown; quarterPlanning?: { approval?: unknown; plan?: unknown } } }, plan: QuarterPlanningInput, rejectedStatus?: number) {
  if (actual.state.baseline || actual.state.quarterPlanning?.approval) return "unknown" as const;
  if (canonicalIdentityClient(actual.state.quarterPlanning?.plan) === canonicalIdentityClient(plan)) return "verified" as const;
  return [400, 401, 403, 409, 422].includes(rejectedStatus ?? 0) ? "rejected" as const : "unknown" as const;
}
export async function identityJson(path: string, body?: unknown) {
  const response = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.message ?? "季度身份读取未完成") as Error & { status?: number }; error.status = response.status; throw error; }
  return data;
}
/** One submit, followed only by original receipt and complete source readback. */
export async function verifyIdentityOperation(command: IdentityApply, original: IdentityPreview, submit: boolean,
  api: typeof identityJson = identityJson) {
  let receipt: IdentityReceipt | undefined, rejection: unknown;
  if (submit) { try { receipt = (await api(identityApi, command)).receipt; } catch (error) { rejection = error; } }
  if (!receipt) {
    try { receipt = (await api(identityApi + "?" + new URLSearchParams({ identityRequestId: command.requestId }))).receipt; }
    catch (error) {
      if ((error as { status?: number }).status === 404 && [400, 401, 403, 409, 422].includes((rejection as { status?: number } | undefined)?.status ?? 0)) return { status: "rejected" as const, error: rejection instanceof Error ? rejection.message : "原操作已拒绝，重新预览后再审" };
      return { status: "unknown" as const, error: "原请求结果尚未核实，只核对原回执，不重复提交" };
    }
  }
  if (!receipt || receipt.actor !== "human" || receipt.requestId !== command.requestId || receipt.reviewHash !== original.reviewHash
    || receipt.selectionHash !== command.review.selectionHash || receipt.beforeHash !== original.readbackHash
    || JSON.stringify(receipt.results.map(row => [row.siteDomain, row.keywordId, row.keyword, row.topicId, row.country, row.language]))
      !== JSON.stringify(original.results.map(row => [row.siteDomain, row.keywordId, row.keyword, row.topicId, row.country, row.language]))) return { status: "unknown" as const, error: "原回执与确切预览不匹配，未再次提交" };
  try {
    const actual: IdentityPreview = await api(identityApi, { action: "preview_identities", requestId: command.requestId, review: command.review });
    if (actual.readbackHash !== receipt.afterHash || actual.createSourceRows !== 0) return { status: "changed" as const, receipt, error: "原操作已有回执，但当前源状态另有变化；请重新核对，未再次提交" };
    return { status: "verified" as const, receipt, actual };
  } catch { return { status: "unknown" as const, receipt, error: "原回执已取得，当前完整源尚未读回；只核对原请求，不重复提交" }; }
}
const wordKey = (word: string) => word.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
/** Only target IDs/source version change; all plan decisions/budgets survive. */
export function rebindInitialQuarterPlan(plan: QuarterPlanningInput, review: PreFreezeReview, targets: GrowthTarget[], sourceVersion: string): QuarterPlanningInput {
  if (plan.version !== "quarter-planning-v2" || plan.targetIds.length !== 1600) throw Error("须先提供完整v2季度方案，不能用身份清单代替方向和投入方案");
  const selected = plan.targetIds.map(id => {
    let parts: string[]; try { parts = id.split(":").map(decodeURIComponent); } catch { throw Error("原季度targetId格式不匹配，请核对原方案"); }
    const members = review.selection.members.filter(row => row.siteDomain === parts[0] && wordKey(row.keyword) === parts[1]);
    if (parts.length !== 4 || members.length !== 1) throw Error("旧方案必须逐项对应同一确切1600原ID清单，不能改词或挑选其他站点别名");
    const member = members[0], rows = targets.filter(row => row.site === member.siteDomain && row.keywordId === member.keywordId && row.keyword === member.keyword && row.membership === "formal");
    if (rows.length !== 1) throw Error("原成员尚未完成正常正式成员核定，或当前身份存在歧义；本入口不升池、不换原ID");
    return rows[0];
  });
  if (new Set(selected.map(row => wordKey(row.keyword))).size !== 1600 || new Set(selected.map(row => row.id)).size !== 1600) throw Error("重读后不是原来的1600个唯一原词，未保存方案");
  return { ...plan, targetIds: selected.map(row => row.id), sourceVersion };
}
