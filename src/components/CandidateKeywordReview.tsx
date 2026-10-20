"use client";
import { useState } from "react";
import { Input, Select, Table, Tag } from "antd";
import { CANDIDATE_REVIEW_LABELS, type CandidateReviewPreview, type CandidateReviewKind } from "@/lib/candidate-keyword-review";
import { dashboardStore } from "@/lib/dashboard-client";

export function CandidateKeywordReview({ onChanged }: { onChanged: () => void }) {
  const [plan, setPlan] = useState<CandidateReviewPreview | null>(null), [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [receipt, setReceipt] = useState<unknown>(null);
  const [filter, setFilter] = useState("SUGGESTED"), [search, setSearch] = useState("");
  async function load() {
    setBusy(true); setMessage(""); setPlan(null); setSelected([]);
    try {
      const response = await fetch("/api/keywords/candidates/cleanup", { cache: "no-store" }), body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "预览读取失败");
      setPlan(body); setSelected(body.rows.filter((row: { kind: CandidateReviewKind }) => row.kind !== "KEEP").map((row: { id: string }) => row.id));
      onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : "预览失败"); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!plan || !selected.length) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/keywords/candidates/cleanup", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywordIds: selected, expectedStateHash: plan.stateHash }) }), body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "移除失败");
      setReceipt(body); setPlan(null); setSelected([]); dashboardStore.clear(); onChanged(); window.dispatchEvent(new Event("seo-rankings-updated"));
      setMessage(`已移除 ${body.changed} 个候选词，剩余 ${body.remaining} 个。可在数据管理的清理记录中恢复。`);
    } catch (error) { setPlan(null); setSelected([]); setMessage(error instanceof Error ? error.message : "移除失败，请刷新核对"); }
    finally { setBusy(false); }
  }
  const rows = (plan?.rows ?? []).filter(row => filter === "ALL" || (filter === "SUGGESTED" ? row.kind !== "KEEP" : row.kind === filter))
    .filter(row => `${row.text} ${row.reason}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="jsonImportPanel" aria-label="候选词批量清理">
    <h2>候选词批量清理</h2><p>检查 Flatkey 候选词中的业务无关、竞品品牌和低质量记录。预览后可调整勾选；移除保留原因并支持恢复。</p>
    <div className="reviewToolbar"><button type="button" disabled={busy} onClick={() => void load()}>{busy ? "正在处理…" : "预览候选词筛选"}</button>
      {plan ? <button type="button" disabled={busy || !selected.length} onClick={() => void apply()}>移除所选 {selected.length} 个候选词</button> : null}
      {receipt ? <button type="button" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = "candidate-cleanup-receipt.json"; a.click(); URL.revokeObjectURL(url); }}>下载清理回执</button> : null}</div>
    {message ? <p role="status">{message}</p> : null}
    {plan ? <><p>候选词共 {plan.total} 个，建议移除 {plan.suggested} 个，已勾选 {selected.length} 个。</p>
      <div className="reviewToolbar"><Input aria-label="搜索清理候选词" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索关键词或原因" />
        <Select aria-label="候选词清理类别" value={filter} onChange={setFilter} options={[{ value: "SUGGESTED", label: "建议移除" }, { value: "ALL", label: "全部候选词" }, ...Object.entries(CANDIDATE_REVIEW_LABELS).map(([value, label]) => ({ value, label }))]} /></div>
      <Table rowKey="id" dataSource={rows} loading={busy} size="small" rowSelection={{ selectedRowKeys: selected, onChange: keys => setSelected(keys.map(String)), preserveSelectedRowKeys: true, getCheckboxProps: row => ({ disabled: row.protected }) }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: total => `共 ${total} 个词` }} columns={[
          { title: "关键词", dataIndex: "text" }, { title: "类别", dataIndex: "kind", render: (kind: CandidateReviewKind) => <Tag color={kind === "KEEP" ? "green" : "orange"}>{CANDIDATE_REVIEW_LABELS[kind]}</Tag> }, { title: "筛选原因", dataIndex: "reason" },
        ]} /></> : null}
  </section>;
}
