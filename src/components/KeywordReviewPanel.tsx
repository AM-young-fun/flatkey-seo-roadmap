"use client";
import { useCallback, useEffect, useState } from "react";
import { Select, Table } from "antd";
import { SITES } from "./useSeoSelection";
import { dashboardStore } from "@/lib/dashboard-client";

type ArchivedKeyword = { id: string; text: string; siteDomain: string; excludedAt: string | null; exclusionReason: string | null };

export function KeywordReviewPanel() {
  const [site, setSite] = useState("flatkey.ai");
  const [rows, setRows] = useState<ArchivedKeyword[]>([]);
  const [page, setPage] = useState(1), [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/keywords/review?siteDomain=${encodeURIComponent(site)}&page=${page}&pageSize=20`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "无法读取清理记录");
      setRows(result.keywords); setTotal(result.total);
      if (page > 1 && !result.keywords.length) setPage(Math.max(1, Math.ceil(result.total / 20)));
    } catch (error) { setMessage(error instanceof Error ? error.message : "无法读取清理记录"); }
    finally { setLoading(false); }
  }, [site, page]);
  useEffect(() => { void load(); }, [load]);
  async function restore(keyword: ArchivedKeyword) {
    setLoading(true); setMessage("");
    try {
      const response = await fetch("/api/keywords/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteDomain: site, action: "restore", keywordIds: [keyword.id] }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "恢复失败");
      dashboardStore.clear();
      setMessage(`已恢复「${keyword.text}」。后续采集会保留该词；归档须重新核对业务意图及外部月度声量证据。`);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "恢复失败"); }
    finally { setLoading(false); }
  }
  return <section className="jsonImportPanel keywordReviewPanel">
    <div><h2>动态清理与恢复</h2><p>在关键词明细的「候选词」分类中，可预览并批量移除业务无关、竞品品牌和低质量词。归档保留原始记录及逐词原因，可在这里恢复。</p><p>未检出排名、未知或单次零搜索量不会自动移除关键词。</p></div>
    <div className="reviewToolbar"><Select aria-label="清理记录所属网站" value={site} onChange={value => { setRows([]); setMessage(""); setPage(1); setSite(value); }} options={SITES.map(item => ({ value: item.domain, label: item.name }))} /><button type="button" disabled={loading} onClick={() => void load()}>刷新清理记录</button></div>
    {message ? <p className="notice" role="status">{message}</p> : null}
    <Table rowKey="id" loading={loading} dataSource={rows} size="small" pagination={{ current: page, pageSize: 20, total, showSizeChanger: false, onChange: setPage, showTotal: count => `共 ${count} 条归档记录` }} columns={[
      { title: "关键词", dataIndex: "text" },
      { title: "清理原因", dataIndex: "exclusionReason", render: value => value ?? "此前手动移除" },
      { title: "清理时间", dataIndex: "excludedAt", render: value => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "此前未记录" },
      { title: "操作", key: "restore", render: (_, keyword) => <button className="textLink" type="button" disabled={loading} onClick={() => void restore(keyword)}>恢复</button> },
    ]} />
  </section>;
}
