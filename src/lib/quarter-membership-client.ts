import type { QuarterMembershipSelection } from "./quarter-membership";
import { canonicalIdentityClient, identityApi, identityJson } from "./pre-freeze-identities-client";

export type MembershipPreview = { status: "PREVIEW"; selectionHash: string; stateHash: string; uniqueWords: number; membershipCount: number;
  changed: number; changes: { siteDomain: string; keywordId: string; from: string; to: string }[]; manifest: QuarterMembershipSelection };
export type MembershipApply = { action: "apply"; requestId: string; selection: QuarterMembershipSelection; selectionHash: string; expectedStateHash: string };
export type MembershipReceipt = { status: "APPLIED"; actor: string; requestId: string; selectionHash: string; sourceHash: string; expectedStateHash: string;
  afterHash: string; changed: number; uniqueWords: number; membershipCount: number; manifest: QuarterMembershipSelection; readbackVerified: boolean; auditId: string };
/** Writes once; success and lost responses both use the exact original audit read. */
export async function verifyMembershipOperation(command: MembershipApply, original: MembershipPreview, submit: boolean, api: typeof identityJson = identityJson) {
  let rejection: unknown;
  if (submit) { try { await api(identityApi, command); } catch (error) { rejection = error; } }
  let receipt: MembershipReceipt;
  try { receipt = await api(identityApi + "?" + new URLSearchParams({ membershipRequestId: command.requestId })); }
  catch (error) {
    if ((error as { status?: number }).status === 404 && [400, 401, 403, 409, 422].includes((rejection as { status?: number } | undefined)?.status ?? 0)) return { status: "rejected" as const, error: rejection instanceof Error ? rejection.message : "原请求已拒绝，重新预览后再确认" };
    return { status: "unknown" as const, error: "原成员请求结果尚未核实，只核对原回执，不重复提交" };
  }
  if (receipt.status !== "APPLIED" || receipt.actor !== "human" || receipt.requestId !== command.requestId || receipt.selectionHash !== original.selectionHash
    || receipt.sourceHash !== command.selection.sourceHash || receipt.expectedStateHash !== command.expectedStateHash
    || receipt.uniqueWords !== original.uniqueWords
    || receipt.membershipCount !== original.membershipCount || canonicalIdentityClient(receipt.manifest) !== canonicalIdentityClient(original.manifest)) {
    return { status: "unknown" as const, error: "原成员审计与本次确切名单不匹配，未再次提交" };
  }
  if (!receipt.readbackVerified) return { status: "changed" as const, receipt, error: "原成员核定已有审计，但当前成员或TopicMap另有变化；未覆盖后续修改" };
  return { status: "verified" as const, receipt };
}
