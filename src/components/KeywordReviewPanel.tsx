"use client";
import { useCallback, useEffect, useState } from "react";
import { Select, Table } from "antd";
import { SITES } from "./useSeoSelection";
import { dashboardStore } from "@/lib/dashboard-client";

type ArchivedKeyword = { id: string; text: string; siteDomain: string; excludedAt: string | null; exclusionReason: string | null };

export function KeywordReviewPanel() {
  const [site, setSite] = useState("flatkey.ai");
  const [rows, setRows] = useState<ArchivedKeyword[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/keywords/review?siteDomain=${encodeURIComponent(site)}&pageSize=500`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "无法读取清理记录");
      setRows(result.keywords);
    } catch (error) { setMessage(error instanceof Error ? error.message : "无法读取清理记录"); }
    finally { setLoading(false); }
  }, [site]);
  useEffect(() => { void load(); }, [load]);
  async function restore(keyword: ArchivedKeyword) {
    setLoading(true); setMessage("");
    try {
      const response = await fetch("/api/keywords/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteDomain: site, action: "restore", keywordIds: [keyword.id] }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "恢复失败");
      dashboardStore.clear();
      setMessage(`已恢复「${keyword.text}」，长期零声量词重新观察 60 天。明确无关词需调整筛检规则，否则下次采集仍会移除。`);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "恢复失败"); }
    finally { setLoading(false); }
  }
  return <section className="jsonImportPanel keywordReviewPanel">
    <div><h2>动态清理与恢复</h2><p>每次采集导入后自动筛检：无关词移出；普通词只有足够的长期零声量证据且没有价值信号时才归档。新模型、新词、数据未知和历史不足的词保留。</p><p>仅移出业务词库和排名统计，保留原始记录及清理原因，可在这里恢复。</p></div>
    <div className="reviewToolbar"><Select aria-label="清理记录所属网站" value={site} onChange={value => { setRows([]); setMessage(""); setSite(value); }} options={SITES.map(item => ({ value: item.domain, label: item.name }))} /><button type="button" disabled={loading} onClick={() => void load()}>刷新清理记录</button></div>
    {message ? <p className="notice" role="status">{message}</p> : null}
    <Table rowKey="id" loading={loading} dataSource={rows} size="small" pagination={{ defaultPageSize: 10 }} columns={[
      { title: "关键词", dataIndex: "text" },
      { title: "清理原因", dataIndex: "exclusionReason", render: value => value ?? "此前手动移除" },
      { title: "清理时间", dataIndex: "excludedAt", render: value => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "此前未记录" },
      { title: "操作", key: "restore", render: (_, keyword) => <button className="textLink" type="button" disabled={loading} onClick={() => void restore(keyword)}>恢复</button> },
    ]} />
  </section>;
}
