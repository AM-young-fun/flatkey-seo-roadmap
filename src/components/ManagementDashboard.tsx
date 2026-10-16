"use client";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { SerpMonitorPanel } from "@/components/SerpMonitorPanel";
import { SourceSyncStatus } from "@/components/SourceSyncStatus";
import { DataforSeoConnection } from "@/components/DataforSeoConnection";
import { KeywordOkrWorkspace } from "@/components/KeywordOkrWorkspace";
import { useKeywordOkr } from "@/components/useKeywordOkr";
import { PageAuditImportPanel } from "@/components/PageAuditImportPanel";

function KeywordTasks() {
  const okr = useKeywordOkr();
  return <KeywordOkrWorkspace okr={okr} section="tasks" />;
}
function KeywordAuditHistory() {
  const okr = useKeywordOkr();
  if (okr.loading) return <p className="muted">正在读取筛检记录…</p>;
  if (okr.error) return <div className="loadError" role="alert"><span>{okr.error}</span><button onClick={okr.refresh}>重新加载</button></div>;
  return <div className="dataforseoRuns">{okr.data?.audits.length ? okr.data.audits.map(audit => <article key={audit.id}><strong>{audit.status === "RESTORED" ? "已恢复" : audit.status === "APPLIED" ? "已完成筛检" : "已记录"}</strong><p>{new Date(audit.restoredAt ?? audit.appliedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} · {audit.changed} 条变更</p></article>) : <p className="muted">暂无筛检记录。</p>}</div>;
}
export function ManagementDashboard() {
  const [tasksOpen, setTasksOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  useEffect(() => {
    const showLinkedSection = () => {
      if (window.location.hash === "#keyword-tasks") setTasksOpen(true);
      if (window.location.hash === "#keyword-audit") setAuditOpen(true);
    };
    showLinkedSection();
    window.addEventListener("hashchange", showLinkedSection);
    return () => window.removeEventListener("hashchange", showLinkedSection);
  }, []);
  return <main className="appShell">
    <PageHeader active="manage" />
    <div className="pageIntro"><h1>数据管理</h1><p>管理排名更新、协作表同步与接口连接。</p></div>
    <SerpMonitorPanel />
    <SourceSyncStatus />
    <details className="managementDisclosure"><summary>页面关联维护<span>核实页面后更新关键词</span></summary><div className="managementDisclosureBody"><PageAuditImportPanel /></div></details>
    <details className="managementDisclosure" open={connectionOpen} onToggle={event => setConnectionOpen(event.currentTarget.open)}><summary>DataForSEO 连接设置<span>查看或更新 API 凭据</span></summary><div className="managementDisclosureBody">{connectionOpen ? <DataforSeoConnection onChanged={() => window.dispatchEvent(new Event("seo-rankings-updated"))} /> : null}</div></details>
    <details className="managementDisclosure" id="keyword-tasks" open={tasksOpen} onToggle={event => setTasksOpen(event.currentTarget.open)}><summary>页面任务<span>按页面合并的建设与优化任务</span></summary><div className="managementDisclosureBody">{tasksOpen ? <KeywordTasks /> : null}</div></details>
    <details className="managementDisclosure" id="keyword-audit" open={auditOpen} onToggle={event => setAuditOpen(event.currentTarget.open)}><summary>筛检记录<span>查看已完成的词库变更</span></summary><div className="managementDisclosureBody">{auditOpen ? <KeywordAuditHistory /> : null}</div></details>
  </main>;
}
