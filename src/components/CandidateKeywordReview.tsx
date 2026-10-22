"use client";

import { useState } from "react";
import { Alert, Button, Input, Select, Table, Tag, Tooltip } from "antd";
import { CheckCircle2, ChevronUp, Download, Info, RefreshCw, Search, ScanSearch, Trash2 } from "lucide-react";
import { CANDIDATE_REVIEW_LABELS, type CandidateReviewPreview, type CandidateReviewKind } from "@/lib/candidate-keyword-review";
import type { KeywordBusiness } from "@/lib/keyword-business";
import { dashboardStore } from "@/lib/dashboard-client";
import styles from "./CandidateKeywordReview.module.css";

const categoryColors: Record<CandidateReviewKind, string> = { KEEP: "default", UNRELATED: "orange", COMPETITOR: "purple", LOW_QUALITY: "gold" };
const number = (value: number) => value.toLocaleString();

export function CandidateKeywordReview({ onChanged, businessCategory, businessLabel = "Flatkey" }: { onChanged: () => void; businessCategory?: KeywordBusiness; businessLabel?: string }) {
  const [plan, setPlan] = useState<CandidateReviewPreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [action, setAction] = useState<"preview" | "remove" | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [receipt, setReceipt] = useState<unknown>(null);
  const [filter, setFilter] = useState("SUGGESTED");
  const [search, setSearch] = useState("");
  const busy = action !== null;

  async function load() {
    setAction("preview"); setNotice(null); setPlan(null); setSelected([]);
    setFilter("SUGGESTED"); setSearch("");
    try {
      const response = await fetch("/api/keywords/candidates/cleanup", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "预览读取失败");
      const rows = (body as CandidateReviewPreview).rows.filter(row => !businessCategory || row.businessCategory === businessCategory);
      setPlan({ ...body, rows, total: rows.length, suggested: rows.filter(row => row.kind !== "KEEP").length });
      setSelected(rows.filter(row => row.kind !== "KEEP").map(row => row.id));
      onChanged();
    } catch (error) { setNotice({ type: "error", text: error instanceof Error ? error.message : "预览失败" }); }
    finally { setAction(null); }
  }

  async function apply() {
    if (!plan || !selected.length) return;
    setAction("remove"); setNotice(null);
    try {
      const response = await fetch("/api/keywords/candidates/cleanup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywordIds: selected, expectedStateHash: plan.stateHash }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "移除失败");
      setReceipt(body); setPlan(null); setSelected([]);
      dashboardStore.clear(); onChanged(); window.dispatchEvent(new Event("seo-rankings-updated"));
      setNotice({ type: "success", text: `已移除 ${number(body.changed)} 个词，${businessLabel} 剩余 ${number(plan.total - body.changed)} 个` });
    } catch (error) {
      setPlan(null); setSelected([]);
      setNotice({ type: "error", text: error instanceof Error ? error.message : "移除失败，请重新筛选" });
    } finally { setAction(null); }
  }

  function downloadReceipt() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = "candidate-cleanup-receipt.json"; link.click();
    URL.revokeObjectURL(url);
  }

  const rows = (plan?.rows ?? [])
    .filter(row => filter === "ALL" || (filter === "SUGGESTED" ? row.kind !== "KEEP" : row.kind === filter))
    .filter(row => `${row.text} ${row.reason}`.toLowerCase().includes(search.trim().toLowerCase()));
  const clean = plan?.suggested === 0 && filter === "SUGGESTED" && !search.trim();

  return <section className={styles.panel} aria-labelledby="candidate-review-heading">
    <div className={styles.header}>
      <div className={styles.title}>
        <span className={styles.titleIcon}><ScanSearch size={18} aria-hidden="true" /></span>
        <h2 id="candidate-review-heading">候选词清理</h2>
        <Tooltip trigger={["hover", "focus", "click"]} title={<div className={styles.help}>筛查业务无关、竞品品牌和低质量词，默认勾选建议移除项，可手动调整。仅处理当前 {businessLabel} 分类下来自 Flatkey 的候选词，正式词和受保护模型词不受影响。移除后可在「数据管理 → 清理记录」恢复。</div>}>
          <button type="button" className={styles.infoButton} aria-label="筛选规则与恢复说明"><Info size={16} aria-hidden="true" /></button>
        </Tooltip>
      </div>
      <div className={styles.actions}>
        {receipt ? <Button type="text" icon={<Download size={15} aria-hidden="true" />} onClick={downloadReceipt}>下载回执</Button> : null}
        <Button type={plan ? "default" : "primary"} icon={plan ? <RefreshCw size={15} aria-hidden="true" /> : <ScanSearch size={15} aria-hidden="true" />} loading={action === "preview"} disabled={action === "remove"} onClick={() => void load()}>{plan ? "重新筛选" : "开始筛选"}</Button>
        {plan && (plan.suggested > 0 || selected.length > 0) ? <Button danger type="primary" icon={<Trash2 size={15} aria-hidden="true" />} loading={action === "remove"} disabled={busy || !selected.length} onClick={() => void apply()}>移除所选{selected.length ? ` (${number(selected.length)})` : ""}</Button> : null}
        {plan ? <Tooltip title="收起筛选结果" trigger={["hover", "focus"]}><Button type="text" aria-label="收起筛选结果" disabled={busy} icon={<ChevronUp size={17} aria-hidden="true" />} onClick={() => { setPlan(null); setSelected([]); }} /></Tooltip> : null}
      </div>
    </div>

    {notice ? <Alert className={styles.notice} type={notice.type} showIcon title={notice.text} role={notice.type === "error" ? "alert" : "status"} /> : null}
    {plan ? <div className={styles.content}>
      <div className={styles.toolbar}>
        <div className={styles.stats} aria-label="筛选统计">
          <span>候选词 <strong>{number(plan.total)}</strong></span>
          <span>建议移除 <strong className={plan.suggested ? styles.warning : undefined}>{number(plan.suggested)}</strong></span>
          {selected.length ? <span>已选 <strong>{number(selected.length)}</strong></span> : null}
        </div>
        <div className={styles.filters}>
          <Input aria-label="搜索清理候选词" allowClear prefix={<Search size={15} aria-hidden="true" />} value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索关键词或原因" />
          <Select aria-label="候选词清理类别" value={filter} onChange={setFilter} options={[{ value: "SUGGESTED", label: "建议移除" }, { value: "ALL", label: "全部候选词" }, ...Object.entries(CANDIDATE_REVIEW_LABELS).map(([value, label]) => ({ value, label }))]} />
        </div>
      </div>
      {rows.length ? <Table className={styles.table} rowKey="id" dataSource={rows} loading={busy} size="small" scroll={{ x: 640 }}
        rowSelection={{ selectedRowKeys: selected, onChange: keys => setSelected(keys.map(String)), preserveSelectedRowKeys: true, getCheckboxProps: row => ({ disabled: busy || row.protected }), columnWidth: 44 }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: [20, 50, 100], responsive: true, showTotal: total => `${number(total)} 个词` }}
        columns={[
          { title: "关键词", dataIndex: "text", width: "42%", render: (text: string) => <span className={styles.keyword}>{text}</span> },
          { title: "类别", dataIndex: "kind", width: 120, render: (kind: CandidateReviewKind) => <Tag bordered={false} color={categoryColors[kind]}>{CANDIDATE_REVIEW_LABELS[kind]}</Tag> },
          { title: "原因", dataIndex: "reason", ellipsis: { showTitle: false }, render: (reason: string) => <Tooltip title={reason}><span className={styles.reason}>{reason}</span></Tooltip> },
        ]} /> : <div className={styles.empty} role="status">
        {clean ? <CheckCircle2 size={20} className={styles.cleanIcon} aria-hidden="true" /> : <Search size={20} aria-hidden="true" />}
        <span>{clean ? "当前规则下暂无需清理的词" : "没有匹配的词"}</span>
        <Button type="link" onClick={() => { setFilter("ALL"); setSearch(""); }}>查看全部</Button>
      </div>}
    </div> : null}
  </section>;
}
