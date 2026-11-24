import type { AddTopicAssociation, TopicAssociationIdentity, TopicAssociationState } from "./site-topic-association";

export type AssociationPreview = { identity: TopicAssociationIdentity; state: TopicAssociationState; stateHash: string; edgeExists: boolean; topicLabels: Record<string, string> };
export type AssociationReceipt = { requestId: string; identity: TopicAssociationIdentity; status: "created" | "reused";
  createdEdge: boolean; beforeHash: string; afterHash: string; appliedAt: string };
export type AssociationResult = { receipt: AssociationReceipt; replay: boolean };
export type AssociationReview = { phase: "idle" | "reading" | "ready" | "saving" | "verifying" | "saved" | "uncertain" | "rejected" | "changed";
  preview: AssociationPreview | null; receipt: AssociationReceipt | null; error: string | null; requestId: string | null };
export type AssociationTransport = { preview: (identity: TopicAssociationIdentity) => Promise<AssociationPreview>;
  add: (command: AddTopicAssociation) => Promise<AssociationResult>; receipt: (requestId: string) => Promise<AssociationResult | null> };
export type AssociationPendingStore = { read: () => AddTopicAssociation | null; write: (command: AddTopicAssociation) => void; clear: () => void };
export const associationIdentityFields = ["siteDomain", "keywordId", "keyword", "topicId"] as const;
export const associationIdentityQuery = (identity: TopicAssociationIdentity) => new URLSearchParams(associationIdentityFields.map(key => [key, identity[key]])).toString();
const sameIdentity = (a: TopicAssociationIdentity | undefined, b: TopicAssociationIdentity) => Boolean(a && associationIdentityFields.every(key => a[key] === b[key]));
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "读取未完成，请核对原请求";
export class AssociationRejected extends Error {}
export const emptyAssociationReview = (): AssociationReview => ({ phase: "idle", preview: null, receipt: null, error: null, requestId: null });

/** All writes originate in confirm(). Unknown responses can only reconcile the
 * same persisted request; a reload cannot mint a second operation for it. */
export function createAssociationReview(identity: TopicAssociationIdentity, transport: AssociationTransport,
  store: AssociationPendingStore, newRequestId: () => string, notify: (view: AssociationReview) => void) {
  let view = emptyAssociationReview(), command: AddTopicAssociation | null = null;
  const change = (patch: Partial<AssociationReview>) => { view = { ...view, ...patch }; notify(view); };
  const clear = () => { try { store.clear(); } catch { /* A retained ID is safe to reconcile again after reload. */ } };
  try {
    const pending = store.read();
    if (pending && sameIdentity(pending, identity) && pending.action === "add" && /^topic-association:[A-Za-z0-9:._-]+$/u.test(pending.requestId)
      && /^[a-f0-9]{64}$/u.test(pending.expectedStateHash)) {
      command = pending; view = { ...view, phase: "uncertain", requestId: pending.requestId, error: "发现尚未核实的原请求，请先核对回执，不重复提交" };
    }
  } catch { view = { ...view, error: "浏览器暂时不能读取原请求记录；提交前必须能保存该记录" }; }
  async function verify(result: AssociationResult) {
    const receipt = result.receipt;
    if (!command || receipt?.requestId !== command.requestId || !sameIdentity(receipt.identity, identity)
      || receipt.beforeHash !== command.expectedStateHash || !["created", "reused"].includes(receipt.status)
      || receipt.createdEdge !== (receipt.status === "created") || !/^[a-f0-9]{64}$/u.test(receipt.afterHash)) throw Error("原回执与本次预览不一致，已停止；不会再次提交");
    change({ phase: "verifying", receipt, error: null });
    const actual = await transport.preview(identity);
    if (!sameIdentity(actual.identity, identity) || actual.stateHash !== receipt.afterHash || !actual.edgeExists
      || !actual.state.assignments.some(edge => edge.siteDomain === identity.siteDomain && edge.keywordId === identity.keywordId && edge.topicId === identity.topicId)) {
      clear(); change({ phase: "changed", preview: actual, error: "原请求已有回执，但当前完整状态此后发生变化；未再次提交，请重新预览核查" }); return;
    }
    clear(); change({ phase: "saved", preview: actual, receipt, error: null });
  }
  async function reconcile(rejection?: unknown) {
    if (!command || ["saving", "reading", "verifying"].includes(view.phase)) return;
    change({ phase: "verifying", error: null });
    try {
      const result = await transport.receipt(command.requestId);
      if (result) { await verify(result); return; }
      if (rejection instanceof AssociationRejected) { clear(); change({ phase: "rejected", error: rejection.message }); return; }
      change({ phase: "uncertain", error: "尚无原回执，结果未核实。请核对原请求，不重复提交" });
    } catch (error) { change({ phase: "uncertain", error: errorMessage(error) + "；未再次提交" }); }
  }
  return {
    snapshot: () => view,
    async preview() {
      if (["reading", "saving", "verifying", "uncertain"].includes(view.phase)) return;
      change({ phase: "reading", error: null, receipt: null });
      try {
        const preview = await transport.preview(identity);
        if (!sameIdentity(preview.identity, identity) || !/^[a-f0-9]{64}$/u.test(preview.stateHash)) throw Error("预览身份或来源指纹不匹配");
        command = { ...identity, action: "add", requestId: newRequestId(), expectedStateHash: preview.stateHash };
        change({ phase: "ready", preview, requestId: command.requestId, error: null });
      } catch (error) { change({ phase: "rejected", error: errorMessage(error) }); }
    },
    async confirm() {
      if (view.phase !== "ready" || !command) return;
      change({ phase: "saving", error: null });
      try { store.write(command); } catch { change({ phase: "rejected", error: "浏览器无法保存原请求编号，尚未提交；请检查浏览器存储" }); return; }
      let response: AssociationResult;
      try { response = await transport.add(command); }
      catch (error) { change({ phase: "uncertain" }); await reconcile(error); return; }
      try { await verify(response); }
      catch (error) { change({ phase: "uncertain", error: errorMessage(error) + "；请核对原请求，未再次提交" }); }
    },
    reconcile,
  };
}

export function associationBrowserTransport(fetcher: typeof fetch = fetch): AssociationTransport {
  const url = "/api/keywords/topic-associations";
  async function read(path: string) {
    const response = await fetcher(path, { credentials: "same-origin", cache: "no-store", redirect: "error" });
    if (response.status === 404) return null;
    const data = await response.json(); if (!response.ok) throw Error(data.message ?? "关联读取未完成"); return data;
  }
  return { preview: async identity => { const result = await read(url + "?" + associationIdentityQuery(identity)); if (!result) throw Error("原词或本站关联不存在"); return result; },
    receipt: requestId => read(url + "?" + new URLSearchParams({ requestId })),
    add: async command => {
      const response = await fetcher(url, { method: "POST", credentials: "same-origin", redirect: "error",
        headers: { "content-type": "application/json" }, body: JSON.stringify(command) });
      const result = await response.json();
      if (!response.ok) { const message = result.message ?? "保存结果未核实"; if ([400, 401, 403, 404, 409, 422].includes(response.status)) throw new AssociationRejected(message); throw Error(message); }
      return result;
    } };
}
