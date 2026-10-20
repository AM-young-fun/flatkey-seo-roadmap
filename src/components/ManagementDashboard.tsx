"use client";
import { useState } from "react";
import { ConfigProvider } from "antd";
import { Cable, ChevronDown } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { SourceSyncStatus } from "@/components/SourceSyncStatus";
import { DataforSeoConnection } from "@/components/DataforSeoConnection";
import { OperationsPanel } from "@/components/OperationsPanel";
import { ApiKeyPanel } from "@/components/ApiKeyPanel";
import { AutomationConnections } from "@/components/AutomationConnections";

export function ManagementDashboard() {
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [automationOpen,setAutomationOpen]=useState(false);
  return <ConfigProvider theme={{ token: { colorPrimary: "#365f9c", borderRadius: 8, controlHeight: 40, fontSize: 13, colorBorder: "#dfe5ed", colorText: "#27384e" }, components: { Select: { optionSelectedBg: "#edf3fb", optionActiveBg: "#f5f7fb" } } }}><main className="appShell managementPage">
    <PageHeader active="manage" />
    <div className="managementIntro"><h1>数据管理</h1><span>北京时间 · UTC+8</span></div>
    <OperationsPanel />
    <details className="managementDisclosure managementConnection" open={automationOpen} onToggle={event=>setAutomationOpen(event.currentTarget.open)}><summary><span className="managementConnectionTitle"><Cable size={18}/>自动取数连接</span><span className="managementConnectionAction">GA4 · 三表采集器<ChevronDown size={15}/></span></summary><div className="managementDisclosureBody">{automationOpen?<AutomationConnections/>:null}</div></details>
    <div className="managementColumns"><ApiKeyPanel /><SourceSyncStatus /></div>
    <details className="managementDisclosure managementConnection" open={connectionOpen} onToggle={event => setConnectionOpen(event.currentTarget.open)}><summary><span className="managementConnectionTitle"><Cable size={18} />DataForSEO 连接</span><span className="managementConnectionAction">连接设置<ChevronDown size={15} /></span></summary><div className="managementDisclosureBody">{connectionOpen ? <DataforSeoConnection onChanged={() => window.dispatchEvent(new Event("seo-rankings-updated"))} /> : null}</div></details>
  </main></ConfigProvider>;
}
