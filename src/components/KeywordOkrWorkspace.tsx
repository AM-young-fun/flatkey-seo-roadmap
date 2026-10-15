"use client";

import { useState } from "react";
import { Select, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { useKeywordOkr } from "@/components/useKeywordOkr";
import { dashboardStore } from "@/lib/dashboard-client";
import { KEYWORD_OKR_AUDIT_ID, type KeywordContentTask, type KeywordOkrMutation, type KeywordOkrMutationResponse } from "@/lib/keyword-okr";

const TASK_LABELS = { NEW: "新建内容", EXPAND: "补强内容", REUSE: "复用主意图" };
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "—";

function UrlList({ urls }: { urls: string[] }) {
  return urls.length ? <div className="evidenceSummary">{urls.map(url => /^https?:\/\//.test(url) ? <a className="observedUrl" href={url} target="_blank" rel="noreferrer" key={url}>{url.replace(/^https?:\/\//, "")}</a> : <span key={url}>{url}</span>)}</div> : <span className="muted">待制作并关联</span>;
}

export function KeywordOkrWorkspace({ okr, section }: { okr: ReturnType<typeof useKeywordOkr>; section: "tasks" | "audit" }) {
  const { data, loading, refresh } = okr;
  const [taskType, setTaskType] = useState("ALL");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<"preview" | "apply" | null>(null);
  const [preview, setPreview] = useState<KeywordOkrMutationResponse | null>(null);
  const [applicationConfirmed, setApplicationConfirmed] = useState(false);
  const initialized = data?.initialized === true;
  const tasks = data?.tasks ?? [];

  async function refreshAppliedData() {
    dashboardStore.clear();
    refresh();
    try { await dashboardStore.read("all", "combined", true); }
    catch { setNotice(previous => `${previous} 搜索证据刷新失败，正式目标应用已获服务端确认；请重新加载证据。`); }
  }

  async function applyAudit(action: "preview" | "apply") {
    if (initialized || applicationConfirmed || (action === "apply" && preview?.status !== "PREVIEW")) return;
    setBusy(true); setPendingAction(action); setNotice("");
    try {
      const mutation: KeywordOkrMutation = { siteDomain: "flatkey.ai", action, auditId: KEYWORD_OKR_AUDIT_ID };
      const response = await fetch("/api/keywords/okr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mutation) });
      const result = await response.json() as KeywordOkrMutationResponse & { message?: string };
      if (!response.ok) throw new Error(result.message ?? (action === "preview" ? "无法预览清理，请重试" : "应用清理失败，请重试"));
      if (result.auditId !== KEYWORD_OKR_AUDIT_ID || result.rankingCaptureEnabled !== false) throw new Error("审计响应不完整，尚未确认应用状态，请刷新核对");
      if (result.status === "APPLIED") {
        setApplicationConfirmed(true); setPreview(null);
        setNotice(`${result.unchanged ? "本审计已应用，未重复写入。" : "清洁目标、页面关联与内容任务已应用。"}排名抓取保持关闭，正在读取数据库结果。`);
        await refreshAppliedData();
      } else if (action === "preview" && result.status === "PREVIEW") { setPreview(result); }
      else { throw new Error("服务端未确认本次操作，请刷新应用状态后核对"); }
    } catch (failure) {
      if (action === "preview") setPreview(null);
      setNotice(failure instanceof Error ? failure.message : "操作失败，请重试");
    } finally { setBusy(false); setPendingAction(null); }
  }

  async function restoreAudit(id: string) {
    if (!window.confirm("恢复本次审计之前的词库状态？这会撤回本批次的词池和页面关联调整，并保留恢复记录。之后有人工变更的记录会由服务端检查，存在冲突时不会覆盖。")) return;
    setBusy(true); setNotice("");
    try {
      const mutation: KeywordOkrMutation = { siteDomain: "flatkey.ai", action: "restore", auditId: id };
      const response = await fetch("/api/keywords/okr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mutation) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "恢复失败，现有状态未被确认更改");
      if (result.status !== "RESTORED") throw new Error("服务端尚未确认恢复，请刷新后核对");
      dashboardStore.clear(); setApplicationConfirmed(false); setPreview(null);
      setNotice(`已恢复本批次之前的状态，变更 ${result.changed} 条；排名抓取继续关闭。`); refresh();
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : "恢复失败，请重试"); }
    finally { setBusy(false); }
  }

  const taskColumns: ColumnsType<KeywordContentTask> = [
    { title: "内容任务", key: "title", width: 290, render: (_, task) => <div className="evidenceSummary"><strong>{task.title}</strong><small>计划地址：{task.plannedUrl}</small></div> },
    { title: "处理方式", key: "type", width: 140, render: (_, task) => <Tag color={task.type === "NEW" ? "blue" : task.type === "EXPAND" ? "orange" : "green"}>{TASK_LABELS[task.type]}</Tag> },
    { title: "可用承接页面", key: "urls", width: 280, render: (_, task) => <UrlList urls={task.targetUrls} /> },
    { title: "负责人", dataIndex: "owner", width: 100, render: (value: string | null) => value ?? "待安排" },
    { title: "截止时间", dataIndex: "dueAt", width: 120, render: (value: string | null) => value ? value.slice(0, 10) : "待安排" },
    { title: "核实结论", dataIndex: "reason", width: 360, render: (value: string) => <span className="okrReason">{value}</span> },
  ];

  if (section === "tasks") return <section className="okrSection" id="content-tasks">
    <div className="okrSectionHeading"><div><h2>页面与内容任务 <span>{initialized ? tasks.length : "—"}</span></h2><p>复用表示已有页面承接主意图，原计划专页仍未制作；负责人和截止时间等待安排。</p></div><Select aria-label="内容任务类型" value={taskType} onChange={setTaskType} options={[{ value: "ALL", label: `全部任务${initialized ? `（${tasks.length}）` : ""}` }, ...Object.entries(TASK_LABELS).map(([value, label]) => ({ value, label: `${label}${initialized ? `（${tasks.filter(task => task.type === value).length}）` : ""}` }))]} style={{ minWidth: 170 }} /></div>
    <Table columns={taskColumns} dataSource={tasks.filter(task => taskType === "ALL" || task.type === taskType)} rowKey="id" loading={loading} scroll={{ x: 1250 }} size="middle" pagination={{ defaultPageSize: 10, showTotal: total => `共 ${total} 个页面任务` }} locale={{ emptyText: initialized ? "当前没有此类任务" : "尚未登记内容任务" }} expandable={{ expandedRowRender: task => <div className="keywordEvidenceDetails"><p><strong>计划主题状态：</strong>{task.status}</p><p>{task.reason}</p><p><strong>关联目标词：</strong>{task.keywords.join("；") || "暂无"}</p>{task.type === "REUSE" ? <p className="chartNote">只确认主意图可由现有页面承接，不将全部辅助词或原计划页面标记为完成。</p> : null}</div> }} />
  </section>;

  return <div>
    {!loading && data && !initialized && !applicationConfirmed ? <div className="okrUninitialized"><strong>清洁名单尚未应用到数据库</strong><p>可用审计日期 {data.availableAudit.asOf}，计划包含 {data.availableAudit.formalKeywords.toLocaleString("zh-CN")} 个正式目标、{data.availableAudit.tasks} 个页面任务。先预览数据库中的预计变更，再应用固定审核批次。</p><div className="okrApplyActions"><button type="button" disabled={busy} onClick={() => void applyAudit("preview")}>{pendingAction === "preview" ? "读取清理预览…" : preview ? "重新预览变更" : "预览词库清理"}</button><button type="button" disabled={busy} onClick={refresh}>刷新应用状态</button></div>
      {preview ? <section className="okrPreview" aria-label="清理变更预览"><h2>应用前预览</h2><p>以下为服务端根据当前数据库计算的预计结果，尚未写入词库。</p><dl><div><dt>正式目标</dt><dd>{preview.summary.formal.toLocaleString("zh-CN")}</dd></div><div><dt>隔离研究</dt><dd>{preview.summary.research.toLocaleString("zh-CN")}</dd></div><div><dt>归档记录</dt><dd>{preview.summary.archived.toLocaleString("zh-CN")}</dd></div><div><dt>归并记录</dt><dd>{preview.summary.merged.toLocaleString("zh-CN")}</dd></div></dl><p>研究池包含原词库中尚未纳入本轮正式目标的历史词；它们不会被当作确定无关词删除。</p><ul><li>页面关联：{preview.summary.mapping.READY ?? 0} 个已有匹配正文的词；{preview.summary.protectedModels} 个模型保护词。</li><li>内容任务：新建 {preview.summary.tasks.NEW ?? 0} 个、补强 {preview.summary.tasks.EXPAND ?? 0} 个、复用主意图 {preview.summary.tasks.REUSE ?? 0} 个；负责人和截止时间保持待安排。</li><li>涉及 {preview.changed.toLocaleString("zh-CN")} 条站点词审计记录。未逐页复核的历史目标保留“待核实”，候选页面不计为完成覆盖。</li></ul><p>应用会调整 Flatkey 词池、目标页面关联并登记内容任务，保留原始来源记录和筛检理由；应用后可在下方恢复本批次之前的状态。排名抓取保持关闭。</p><button className="okrApplyPrimary" type="button" disabled={busy} onClick={() => void applyAudit("apply")}>{pendingAction === "apply" ? "正在应用清理与任务…" : "应用清理并登记任务"}</button><small>固定审计：{preview.auditId}</small></section> : null}
    </div> : null}
    {applicationConfirmed && !initialized ? <p className="cacheNotice" role="status">服务端已确认审计应用，正在核对数据库读取结果。<button className="okrRefresh" type="button" onClick={refresh}>重新读取</button></p> : null}
    {notice ? <p className="cacheNotice" role="status">{notice}</p> : null}
    <section className="okrSection"><div className="okrSectionHeading"><div><h2>应用与恢复记录</h2><p>研究、归档和归并均保留审计痕迹；批次恢复会检查后续变更冲突。</p></div></div><Table rowKey="id" dataSource={data?.audits ?? []} loading={loading} pagination={false} size="small" scroll={{ x: 850 }} locale={{ emptyText: "尚无已应用审计批次" }} columns={[
      { title: "审计批次", dataIndex: "id" }, { title: "状态", dataIndex: "status", render: (value: string) => value === "APPLIED" ? "已应用" : value === "RESTORED" ? "已恢复" : value },
      { title: "应用时间", dataIndex: "appliedAt", render: dateTime }, { title: "恢复时间", dataIndex: "restoredAt", render: dateTime }, { title: "变更记录", dataIndex: "changed" },
      { title: "操作", key: "restore", render: (_, audit) => audit.status === "APPLIED" && audit.id === KEYWORD_OKR_AUDIT_ID ? <button type="button" className="okrRestore" disabled={busy || loading} onClick={() => void restoreAudit(audit.id)}>{busy ? "恢复中…" : "恢复本批次之前的状态"}</button> : "—" },
    ]} /></section>
  </div>;
}
