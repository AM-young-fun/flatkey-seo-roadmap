"use client";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { SourceSyncStatus } from "@/components/SourceSyncStatus";
import { DataforSeoConnection } from "@/components/DataforSeoConnection";

export function ManagementDashboard() {
  const [connectionOpen, setConnectionOpen] = useState(false);
  return <main className="appShell">
    <PageHeader active="manage" />
    <div className="pageIntro"><h1>数据管理</h1><p>协作表同步与 DataForSEO 连接。</p></div>
    <SourceSyncStatus />
    <details className="managementDisclosure" open={connectionOpen} onToggle={event => setConnectionOpen(event.currentTarget.open)}><summary>DataForSEO 连接设置<span>查看或更新 API 凭据</span></summary><div className="managementDisclosureBody">{connectionOpen ? <DataforSeoConnection onChanged={() => window.dispatchEvent(new Event("seo-rankings-updated"))} /> : null}</div></details>
  </main>;
}
