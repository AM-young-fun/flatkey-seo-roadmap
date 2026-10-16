"use client";

import { useState } from "react";
import { Select, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { KeywordOkrItem } from "@/lib/keyword-okr";
import { CONTENT_ACTION_LABELS, contentPlansCsv, keywordContentPlans, type ContentPlanItem } from "@/lib/keyword-content-plans";

const colors = { LINK: "green", EXPAND: "gold", BUILD: "red" } as const;
export function KeywordContentPlans({ items, loading }: { items: KeywordOkrItem[]; loading: boolean }) {
  const [action, setAction] = useState("ALL");
  const [original, setOriginal] = useState("ALL");
  const [search, setSearch] = useState("");
  const plans = keywordContentPlans(items);
  const rows = plans.filter(item => action === "ALL" || item.workPlan.action === action)
    .filter(item => original === "ALL" || item.workPlan.originalVerdict === original)
    .filter(item => `${item.text} ${item.workPlan.proposedTitle} ${item.workPlan.pageUrls.join(" ")} ${item.workPlan.requirements.join(" ")}`.toLowerCase().includes(search.trim().toLowerCase()));
  const count = (value: string) => plans.filter(item => item.workPlan.action === value).length;
  function download() {
    const url = URL.createObjectURL(new Blob([contentPlansCsv(rows)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "Flatkey-逐词内容优化清单.csv"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const columns: ColumnsType<ContentPlanItem> = [
    { title: "关键词 / 原问题", key: "keyword", width: 230, render: (_, item) => <div className="evidenceSummary"><strong>{item.text}</strong><small>原：{item.workPlan.originalVerdict === "CONTENT_GAP" ? "待优化（已有页面）" : "页面错配"}</small></div> },
    { title: "处理方式", key: "action", width: 160, render: (_, item) => <div className="evidenceSummary"><Tag color={colors[item.workPlan.action]}>{CONTENT_ACTION_LABELS[item.workPlan.action]}</Tag><small>{item.workPlan.action === "LINK" ? "页面关联已更新" : item.workPlan.action === "EXPAND" ? "已有页面，优化待完成" : "无合适页面，建设待完成"}</small></div> },
    { title: "处理页面 / 建议标题", key: "pages", width: 310, render: (_, item) => <div className="evidenceSummary"><strong>{item.workPlan.proposedTitle}</strong>{item.workPlan.pageUrls.length ? item.workPlan.pageUrls.map(url => <a className="observedUrl" key={url} href={url} target="_blank" rel="noreferrer">{url.replace(/^https?:\/\//, "")}</a>) : <span className="muted">未找到合适现有页面，需新建</span>}</div> },
    { title: "具体要求 / 关联依据", key: "requirements", width: 510, render: (_, item) => <ol className="contentPlanChecklist">{item.workPlan.requirements.map((text, index) => <li key={index}>{text}</li>)}</ol> },
    { title: "验收标准", key: "acceptance", width: 380, render: (_, item) => <ol className="contentPlanChecklist">{item.workPlan.acceptance.map((text, index) => <li key={index}>{text}</li>)}</ol> },
  ];
  return <section className="contentPlanWorkspace">
    <div className="contentPlanIntro"><div><h2>逐词内容优化清单</h2><p>待优化：在已有页面补充或调整内容。待建设：没有合适页面，需要新建。相关工作已按页面合并到页面任务，同一页面的多个词一起处理。</p></div><button type="button" className="okrRefresh" disabled={!rows.length} onClick={download}>下载当前清单（CSV）</button></div>
    <div className="contentPlanSummary" role="status"><span>共 <strong>{plans.length}</strong> 个词</span><span>已关联 <strong>{count("LINK")}</strong></span><span>待优化（已有页面）<strong>{count("EXPAND")}</strong></span><span>待建设（无合适页面）<strong>{count("BUILD")}</strong></span></div>
    <div className="detailToolbar"><div className="detailFilters"><label className="originSelectField"><span>处理方式</span><Select aria-label="内容处理方式" value={action} onChange={setAction} options={[{ value: "ALL", label: "全部处理方式" }, ...Object.entries(CONTENT_ACTION_LABELS).map(([value, label]) => ({ value, label }))]} /></label><label className="originSelectField"><span>原问题</span><Select aria-label="原页面问题" value={original} onChange={setOriginal} options={[{ value: "ALL", label: "全部原问题" }, { value: "CONTENT_GAP", label: "原待优化（已有页面）" }, { value: "MISMATCH", label: "原页面错配" }]} /></label></div><label className="searchField"><input aria-label="搜索优化关键词或内容要求" placeholder="搜索关键词、页面或内容要求…" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
    <p className="chartNote">当前显示 {rows.length} 个词。已关联仅表示页面覆盖核验通过；排名以独立的DataForSEO SERP实测为准。</p>
    <div className="tablePanel"><Table className="contentPlanTable" columns={columns} dataSource={rows} rowKey="id" loading={loading} scroll={{ x: 1590 }} pagination={{ defaultPageSize: 20, showSizeChanger: true, showTotal: total => `共 ${total} 个词` }} expandable={{ expandedRowRender: item => <div className="keywordEvidenceDetails"><p><strong>复核结论：</strong>{item.latestPageAuditReason}</p>{item.workPlan.previousPageUrl ? <p>原关联页面：<a href={item.workPlan.previousPageUrl} target="_blank" rel="noreferrer">{item.workPlan.previousPageUrl}</a></p> : null}<p>核验于：{item.latestPageAuditCheckedAt ? new Date(item.latestPageAuditCheckedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "未记录"}</p></div> }} /></div>
  </section>;
}
