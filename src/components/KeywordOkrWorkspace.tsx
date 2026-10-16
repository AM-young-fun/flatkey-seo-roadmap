"use client";

import { useState } from "react";
import { Input, Select, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { useKeywordOkr } from "@/components/useKeywordOkr";
import { dashboardStore } from "@/lib/dashboard-client";
import { KEYWORD_OKR_AUDIT_ID, type KeywordContentTask, type KeywordOkrMutation, type KeywordOkrMutationResponse } from "@/lib/keyword-okr";
import type { PageTaskMergeResult, PageTaskMergeSummary } from "@/lib/keyword-page-tasks";
import { matchesPageTask, pageTaskChecklist, PAGE_TASK_LABELS, PAGE_TASK_SITE_LABELS, PAGE_TASK_STATUS_LABELS, pageTasksCsv, primaryPageTaskUrl } from "@/lib/keyword-page-task-view";

const dateTime = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "—";

function UrlList({ urls }: { urls: string[] }) {
  return urls.length ? <div className="evidenceSummary">{urls.map(url => /^https?:\/\//.test(url) ? <a className="observedUrl" href={url} target="_blank" rel="noreferrer" key={url}>{url.replace(/^https?:\/\//, "")}</a> : <span key={url}>{url}</span>)}</div> : <span className="muted">待制作并关联</span>;
}

export function KeywordOkrWorkspace({ okr, section }: { okr: ReturnType<typeof useKeywordOkr>; section: "tasks" | "audit" }) {
  const { data, loading, refresh } = okr;
  const [taskType, setTaskType] = useState("ALL");
  const [taskSite, setTaskSite] = useState("all");
  const [taskSearch, setTaskSearch] = useState("");
  const [taskMergeBusy, setTaskMergeBusy] = useState<"preview" | "apply" | null>(null);
  const [taskMergePreviews, setTaskMergePreviews] = useState<PageTaskMergeResult[]>([]);
  const [taskMergeNotice, setTaskMergeNotice] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<"preview" | "apply" | null>(null);
  const [preview, setPreview] = useState<KeywordOkrMutationResponse | null>(null);
  const [applicationConfirmed, setApplicationConfirmed] = useState(false);
  const initialized = data?.initialized === true;
  const tasksInitialized = Boolean(okr.pageTasks) || initialized;
  const allTasks: KeywordContentTask[] = okr.pageTasks?.tasks ?? (data?.tasks ?? []).map(task => ({ ...task, siteDomain: "flatkey.ai" }));
  const tasks = allTasks.filter(task => taskSite === "all" || task.siteDomain === taskSite);
  const visibleTasks = tasks.filter(task => (taskType === "ALL" || task.type === taskType) && matchesPageTask(task, taskSearch));
  const pendingWords = new Set((data?.keywords ?? []).filter(item => item.active && item.pool === "FORMAL" && item.workPlan && item.workPlan.action !== "LINK").map(item => item.text.normalize("NFKC").toLocaleLowerCase()));
  const assignedWords = new Set(tasks.flatMap(task => (task.workPlans ?? []).map(plan => plan.keyword.normalize("NFKC").toLocaleLowerCase())));
  const selectedSites = okr.pageTasks?.sites.filter(site => taskSite === "all" || site.siteDomain === taskSite);
  const pendingCount = selectedSites ? selectedSites.reduce((sum, site) => sum + site.pendingKeywords, 0) : pendingWords.size;
  const assignedCount = selectedSites ? selectedSites.reduce((sum, site) => sum + site.assignedKeywords, 0) : [...pendingWords].filter(word => assignedWords.has(word)).length;
  const taskMergePreview = taskMergePreviews.length ? {
    summary: Object.fromEntries(Object.keys(taskMergePreviews[0].summary).map(key => [key, taskMergePreviews.reduce((sum, plan) => sum + plan.summary[key as keyof PageTaskMergeSummary], 0)])) as PageTaskMergeSummary,
    conflicts: taskMergePreviews.flatMap(plan => plan.conflicts.map(conflict => `${PAGE_TASK_SITE_LABELS[plan.siteDomain]}：${conflict}`)),
    tasks: taskMergePreviews.flatMap(plan => plan.tasks.map(task => ({ ...task, siteDomain: plan.siteDomain }))),
  } : null;

  async function mergePageTasks(action: "preview" | "apply") {
    if (taskMergeBusy || !tasksInitialized || (action === "apply" && (!taskMergePreview || taskMergePreview.conflicts.length))) return;
    setTaskMergeBusy(action); setTaskMergeNotice("");
    const completed: PageTaskMergeResult[] = [];
    try {
      const sites = action === "apply" ? taskMergePreviews.map(plan => plan.siteDomain) : selectedSites ? selectedSites.filter(site => site.pendingKeywords > 0).map(site => site.siteDomain) : ["flatkey.ai"];
      for (const siteDomain of sites) {
        const response = await fetch("/api/keywords/okr/tasks", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ siteDomain, action, ...(action === "apply" ? { expectedStateHash: taskMergePreviews.find(plan => plan.siteDomain === siteDomain)!.stateHash } : {}) }) });
        const result = await response.json() as PageTaskMergeResult & { message?: string };
        if (!response.ok) throw new Error(`${PAGE_TASK_SITE_LABELS[siteDomain]}：${result.message ?? "页面任务合并未完成，请重新预览"}`);
        if (result.siteDomain !== siteDomain || result.action !== action || !/^[a-f0-9]{64}$/.test(result.stateHash) || !result.summary || !Array.isArray(result.conflicts) || !Array.isArray(result.tasks)) throw new Error("服务端返回的页面任务结果不完整，请刷新后重试");
        if (result.status !== (action === "preview" ? "PREVIEW" : "APPLIED") || (action === "apply" && result.conflicts.length)) throw new Error("服务端尚未确认本次合并状态，请重新预览核对");
        completed.push(result);
      }
      if (action === "preview") setTaskMergePreviews(completed);
      else {
        setTaskMergePreviews([]);
        setTaskMergeNotice(`已保存 ${completed.length} 个网站的页面任务合并：新增 ${completed.reduce((sum, plan) => sum + plan.summary.created, 0)} 个任务，复用 ${completed.reduce((sum, plan) => sum + plan.summary.reused, 0)} 个。`);
        refresh();
      }
    } catch (failure) {
      setTaskMergePreviews([]);
      setTaskMergeNotice(`${action === "apply" && completed.length ? `已保存 ${completed.map(plan => PAGE_TASK_SITE_LABELS[plan.siteDomain]).join("、")} 的任务；` : ""}${failure instanceof Error ? failure.message : "页面任务合并失败，请重试"}`);
      if (action === "apply" && completed.length) refresh();
    } finally { setTaskMergeBusy(null); }
  }

  function downloadPageTasks() {
    const url = URL.createObjectURL(new Blob([pageTasksCsv(visibleTasks)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "按页面内容任务.csv"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function refreshAppliedData() {
    dashboardStore.clear();
    refresh();
    try { await dashboardStore.read("all", "dataforseo_labs", true); }
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
        setNotice(`${result.unchanged ? "本审计已应用，未重复写入。" : "清洁目标、页面关联与内容任务已应用。"}正在读取词库结果；DataForSEO 排名需在数据管理中手动更新。`);
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
      setNotice(`已恢复本批次之前的状态，变更 ${result.changed} 条；本次不会触发 DataForSEO 排名更新。`); refresh();
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : "恢复失败，请重试"); }
    finally { setBusy(false); }
  }

  const taskColumns: ColumnsType<KeywordContentTask> = [
    { title: "页面任务", key: "title", width: 310, render: (_, task) => <div className="evidenceSummary"><small>{PAGE_TASK_SITE_LABELS[task.siteDomain ?? "flatkey.ai"] ?? task.siteDomain}</small><strong>{task.title}</strong>{task.type === "NEW" ? <small>规划地址：{primaryPageTaskUrl(task)}</small> : <UrlList urls={[primaryPageTaskUrl(task)]} />}{primaryPageTaskUrl(task) !== task.plannedUrl ? <small>原规划地址：{task.plannedUrl}</small> : null}</div> },
    { title: "关联关键词", key: "keywords", width: 270, render: (_, task) => <div className="evidenceSummary"><div>{task.keywords.slice(0, 4).map(word => <Tag key={word}>{word}</Tag>)}</div><small>共 {task.keywords.length} 个词{task.keywords.length > 4 ? "，展开查看全部" : ""}</small></div> },
    { title: "处理方式 / 状态", key: "type", width: 160, render: (_, task) => <div className="evidenceSummary"><Tag color={task.type === "NEW" ? "blue" : task.type === "EXPAND" ? "orange" : "green"}>{PAGE_TASK_LABELS[task.type]}</Tag><small>{PAGE_TASK_STATUS_LABELS[task.status] ?? task.status}</small></div> },
    { title: "内容要求", key: "requirements", width: 360, render: (_, task) => {
      const checklist = pageTaskChecklist(task);
      return checklist.requirements.length ? <div className="evidenceSummary"><ol className="contentPlanChecklist">{checklist.requirements.slice(0, 2).map((text, index) => <li key={index}>{text}</li>)}</ol><small>{checklist.requirements.length} 项具体要求 · {checklist.acceptance.length} 项验收，展开查看逐词清单</small></div> : <span className="okrReason">{task.reason}</span>;
    } },
    { title: "负责人 / 截止", key: "owner", width: 140, render: (_, task) => <div className="evidenceSummary"><span>{task.owner ?? "待安排负责人"}</span><small>{task.dueAt ? `截止 ${task.dueAt.slice(0, 10)}` : "截止时间待安排"}</small></div> },
  ];

  if (section === "tasks" && okr.error) return <div className="loadError" role="alert"><span>{okr.error}</span><button onClick={refresh}>重新加载</button></div>;
  if (section === "tasks") return <section className="okrSection" id="content-tasks">
    <div className="okrSectionHeading"><div><h2>页面任务 <span>{tasksInitialized ? tasks.length : "—"}</span></h2><p>三个网站的建设与优化任务统一展示。同一页面的关键词合为一个任务，保留负责人、进度和截止时间。</p></div><button className="okrRefresh" type="button" disabled={loading || !visibleTasks.length} onClick={downloadPageTasks}>下载按页面任务 CSV</button></div>
    {tasksInitialized ? <div className="contentPlanSummary"><span>待处理关键词 <strong>{pendingCount}</strong></span><span>已关联任务 <strong>{assignedCount}</strong></span><span>页面任务 <strong>{tasks.length}</strong></span></div> : null}
    {tasksInitialized ? <div className="okrUninitialized"><strong>合并已核实的内容清单</strong><p>把优化现有页面和待建设词归入页面任务。相同页面复用原任务，重复任务合并后保留记录。</p><div className="okrApplyActions"><button type="button" disabled={Boolean(taskMergeBusy) || loading || !pendingCount} onClick={() => void mergePageTasks("preview")}>{taskMergeBusy === "preview" ? "正在读取合并预览…" : taskMergePreview ? "重新预览页面合并" : "预览页面任务合并"}</button><button type="button" disabled={Boolean(taskMergeBusy) || loading} onClick={() => { setTaskMergePreviews([]); refresh(); }}>刷新任务</button></div>
      {taskMergePreview ? <section className="okrPreview" aria-label="页面任务合并预览"><h2>合并前预览</h2><p>{taskMergePreview.summary.expandKeywords} 个补充词、{taskMergePreview.summary.buildKeywords} 个待建设词，将归入 {taskMergePreview.summary.pageTasks} 个页面任务（补充 {taskMergePreview.summary.expandPages} 页、建设 {taskMergePreview.summary.buildPages} 页）。</p><dl><div><dt>新增任务</dt><dd>{taskMergePreview.summary.created}</dd></div><div><dt>复用旧任务</dt><dd>{taskMergePreview.summary.reused}</dd></div><div><dt>归并旧任务</dt><dd>{taskMergePreview.summary.retired}</dd></div><div><dt>其他保留任务</dt><dd>{taskMergePreview.summary.retained}</dd></div></dl>
        {taskMergePreview.conflicts.length ? <div role="alert"><strong>以下冲突需解决后才能应用：</strong><ul>{taskMergePreview.conflicts.map((conflict, index) => <li key={index}>{conflict}</li>)}</ul></div> : <p>合并会保留各关键词的具体要求，页面规划地址不会因此被标记为已上线。</p>}
        <details><summary>查看全部页面与关键词分组</summary><Table size="small" rowKey="id" dataSource={taskMergePreview.tasks} pagination={{ defaultPageSize: 5, showTotal: total => `共 ${total} 个分组` }} scroll={{ x: 700 }} columns={[
          { title: "页面 / 规划地址", key: "page", width: 340, render: (_, task) => <div className="evidenceSummary"><small>{PAGE_TASK_SITE_LABELS[task.siteDomain]}</small><strong>{task.title}</strong><small>{task.plannedUrl}</small></div> },
          { title: "关联关键词", key: "keywords", render: (_, task) => task.keywords.join("；") },
          { title: "合并方式", key: "disposition", width: 110, render: (_, task) => task.disposition === "CREATE" ? "新增" : task.disposition === "UPDATE" ? "复用并更新" : "保持现状" },
        ]} /></details>
        <button className="okrApplyPrimary" type="button" disabled={Boolean(taskMergeBusy) || taskMergePreview.conflicts.length > 0} onClick={() => void mergePageTasks("apply")}>{taskMergeBusy === "apply" ? "正在合并页面任务…" : "应用页面任务合并"}</button>
      </section> : null}
    </div> : null}
    {taskMergeNotice ? <p className="cacheNotice" role="status">{taskMergeNotice}</p> : null}
    <div className="okrSectionHeading"><Input aria-label="搜索页面任务" placeholder="搜索页面、关键词或具体要求" value={taskSearch} onChange={event => setTaskSearch(event.target.value)} allowClear style={{ maxWidth: 400 }} /><div className="okrApplyActions">{okr.pageTasks ? <Select aria-label="页面任务网站" value={taskSite} onChange={value => { setTaskSite(value); setTaskMergePreviews([]); }} options={[{ value: "all", label: `全部网站（${allTasks.length}）` }, ...okr.pageTasks.sites.map(site => ({ value: site.siteDomain, label: `${PAGE_TASK_SITE_LABELS[site.siteDomain]}（${site.taskCount}）` }))]} style={{ minWidth: 180 }} /> : null}<Select aria-label="内容任务类型" value={taskType} onChange={setTaskType} options={[{ value: "ALL", label: `全部任务${tasksInitialized ? `（${tasks.length}）` : ""}` }, ...Object.entries(PAGE_TASK_LABELS).map(([value, label]) => ({ value, label: `${label}${tasksInitialized ? `（${tasks.filter(task => task.type === value).length}）` : ""}` }))]} style={{ minWidth: 180 }} /></div></div>
    <Table columns={taskColumns} dataSource={visibleTasks} rowKey="id" loading={loading} scroll={{ x: 1300 }} size="middle" pagination={{ defaultPageSize: 10, showTotal: total => `共 ${total} 个页面任务` }} locale={{ emptyText: tasksInitialized ? "当前没有匹配的页面任务" : "尚未登记页面任务" }} expandable={{ columnTitle: "详情", expandedRowRender: task => {
      const checklist = pageTaskChecklist(task);
      return <div className="keywordEvidenceDetails"><p><strong>核实结论：</strong>{task.reason}</p><p><strong>关联目标词（{task.keywords.length}）：</strong>{task.keywords.join("；") || "暂无"}</p><p><strong>{task.type === "NEW" ? "规划地址（页面待建设）" : "主要处理页面"}：</strong>{primaryPageTaskUrl(task)}</p>{primaryPageTaskUrl(task) !== task.plannedUrl ? <p className="chartNote">原规划地址：{task.plannedUrl}，当前任务复用上述已核实页面。</p> : null}
        {task.type === "REUSE" ? <p className="chartNote">已有页面承接主意图；辅助词是否完整覆盖，按以下要求验收。</p> : null}
        {checklist.requirements.length ? <section><h3>页面具体要求</h3><ol className="contentPlanChecklist">{checklist.requirements.map((text, index) => <li key={index}>{text}</li>)}</ol></section> : null}
        {checklist.acceptance.length ? <section><h3>验收标准</h3><ol className="contentPlanChecklist">{checklist.acceptance.map((text, index) => <li key={index}>{text}</li>)}</ol></section> : null}
        {task.workPlans?.length ? <details><summary>查看逐词要求与已核实的相关页面（{task.workPlans.length} 词）</summary>{task.workPlans.map(plan => <section key={plan.keywordId}><h3>{plan.keyword}</h3><p>{plan.proposedTitle}</p><ol className="contentPlanChecklist">{plan.requirements.map((text, index) => <li key={index}>{text}</li>)}</ol><p><strong>验收：</strong>{plan.acceptance.join("；")}</p>{plan.pageUrls.length ? <UrlList urls={plan.pageUrls} /> : <span className="muted">确无合适页面，按本任务建设</span>}</section>)}</details> : null}
      </div>;
    } }} />
  </section>;

  return <div>
    {!loading && data && !initialized && !applicationConfirmed ? <div className="okrUninitialized"><strong>清洁名单尚未应用到数据库</strong><p>可用审计日期 {data.availableAudit.asOf}，计划包含 {data.availableAudit.formalKeywords.toLocaleString("zh-CN")} 个正式目标、{data.availableAudit.tasks} 个页面任务。先预览数据库中的预计变更，再应用固定审核批次。</p><div className="okrApplyActions"><button type="button" disabled={busy} onClick={() => void applyAudit("preview")}>{pendingAction === "preview" ? "读取清理预览…" : preview ? "重新预览变更" : "预览词库清理"}</button><button type="button" disabled={busy} onClick={refresh}>刷新应用状态</button></div>
      {preview ? <section className="okrPreview" aria-label="清理变更预览"><h2>应用前预览</h2><p>以下为服务端根据当前数据库计算的预计结果，尚未写入词库。</p><dl><div><dt>正式目标</dt><dd>{preview.summary.formal.toLocaleString("zh-CN")}</dd></div><div><dt>隔离研究</dt><dd>{preview.summary.research.toLocaleString("zh-CN")}</dd></div><div><dt>归档记录</dt><dd>{preview.summary.archived.toLocaleString("zh-CN")}</dd></div><div><dt>归并记录</dt><dd>{preview.summary.merged.toLocaleString("zh-CN")}</dd></div></dl><p>研究池包含原词库中尚未纳入本轮正式目标的历史词；它们不会被当作确定无关词删除。</p><ul><li>页面关联：{preview.summary.mapping.READY ?? 0} 个已有匹配正文的词；{preview.summary.protectedModels} 个模型保护词。</li><li>内容任务：新建 {preview.summary.tasks.NEW ?? 0} 个、补强 {preview.summary.tasks.EXPAND ?? 0} 个、复用主意图 {preview.summary.tasks.REUSE ?? 0} 个；负责人和截止时间保持待安排。</li><li>涉及 {preview.changed.toLocaleString("zh-CN")} 条站点词审计记录。未逐页复核的历史目标保留“待核实”，候选页面不计为完成覆盖。</li></ul><p>应用会调整 Flatkey 词池、目标页面关联并登记内容任务，保留原始来源记录和筛检理由；应用后可在下方恢复本批次之前的状态。本次不会触发 DataForSEO 排名更新。</p><button className="okrApplyPrimary" type="button" disabled={busy} onClick={() => void applyAudit("apply")}>{pendingAction === "apply" ? "正在应用清理与任务…" : "应用清理并登记任务"}</button><small>固定审计：{preview.auditId}</small></section> : null}
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
