"use client";
import { useEffect, useState } from "react";
import { FeedbackButton } from "./FeedbackButton";
import { useSeoRead } from "./useSeoAnalytics";
import { GrowthQuarterReview } from "./GrowthGoalSummary";
import { SeoTablePagination } from "./SeoTablePagination";
import Link from "./AppLink";
import styles from "./GrowthTopicWorkspace.module.css";
import { SeoAnchor } from "@/components/SeoAnchor";
import type { GrowthHotspotItem, GrowthHotspotView } from "@/lib/growth-hotspots";
import type { SeoTablePagination as Pagination } from "@/lib/seo-table-page";

type HotspotPage = GrowthHotspotView & { pagination: Pagination };
const stages: Record<string, string> = { needs_decision: "研究完成 · 待人工定方向", approved: "方向已批准", scheduled: "已追加当周计划", in_progress: "制作中", published: "已发布", reviewed: "已复盘", expired: "已过有效期", rejected: "不采纳" };
const statuses: Record<string, string> = { planned: "已规划", researching: "研究中", in_progress: "进行中", completed: "已完成", published: "已发布", blocked: "受阻", paused: "已暂停", failed: "失败", review: "待审" };
function EvidenceLinks({ evidence, label }: { evidence?: unknown[]; label: string }) {
  if (!evidence?.length) return <small>{label}尚未保存</small>;
  return <details className={styles.planned}><summary>{label} {evidence.length} 条</summary>{evidence.map((raw, index) => {
    const row = typeof raw === "string" ? { reference: raw } : raw as Record<string, unknown>;
    const url = typeof row.url === "string" ? row.url : typeof row.reference === "string" ? row.reference : "";
    let href: string | null = null; try { if (new URL(url).protocol === "https:") href = url; } catch { /* Display recorded text without inventing a URL. */ }
    const text = String(row.title ?? row.supports ?? row.reference ?? row.source ?? "原始证据");
    return <div key={index}>{href ? <SeoAnchor href={href} target="_blank" rel="noreferrer">{text} ↗</SeoAnchor> : <span>{text}</span>}{typeof row.observedAt === "string" ? <small>{row.observedAt}</small> : null}</div>;
  })}</details>;
}
export function GrowthHotspotWorkspace() {
  const [page, setPage] = useState(1);
  const read = useSeoRead<HotspotPage>(`/api/seo/growth/hotspots?page=${page}`);
  const [busy, setBusy] = useState<string | null>(null), [messages, setMessages] = useState<Record<string, string>>({});
  useEffect(() => { const refresh = () => read.retry(); addEventListener("seo-growth-updated", refresh); return () => removeEventListener("seo-growth-updated", refresh); }, [read.retry]);
  const retryAdmission = async (item: GrowthHotspotItem) => {
    if (busy || !item.directionId || !item.directionRevision) return;
    setBusy(item.id);
    try {
      const response = await fetch("/api/seo/growth/hotspots/admit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ directionId: item.directionId, revision: item.directionRevision, taskIds: item.tasks.filter(task => task.kind === "blog").map(task => task.id) }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.message ?? "原任务追加尚未完成");
      setMessages(value => ({ ...value, [item.id]: result.items?.map((row: { reason: string }) => row.reason).join("；") ?? "已重新核验原任务" })); read.retry();
    } catch (error) { setMessages(value => ({ ...value, [item.id]: error instanceof Error ? error.message : "核验未完成，请按原任务重试" })); } finally { setBusy(null); }
  };
  return <>
    <section className={styles.panel} aria-label="近期热点词与当周额外任务"><div className={styles.sectionHeading}><div><h2>近期热点词</h2><p>{read.data ? `任务业务周 ${read.data.businessWeek.start}—${read.data.businessWeek.end}（北京时间）· ${read.data.pagination.total} 项真实研究记录` : "读取已完成研究、人工方向决定与当周原任务进度"}</p></div></div>
      <p className={styles.note}>AI完成事件核验、需求研究、竞争分析和去重后，由你判断方向。批准的热点作为当周额外工作并行推进，保留原计划名额、任务ID及交付日；不改变季度1600词。无法按期完成时明确报告冲突。</p>
      {read.error ? <p role="alert">热点记录读取失败：{read.error}<button className={styles.more} onClick={read.retry}>重试</button></p> : !read.data ? <p role="status">正在读取真实热点研究与任务…</p> : !read.data.items.length ? <p className={styles.empty}>当前没有已保存的热点研究记录；不以历史机会词库填充。</p> : <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>热点词与话题</th><th>事件与研究证据</th><th>人工方向决定</th><th>当周原任务与进度</th></tr></thead><tbody>{read.data.items.map(item => <tr key={item.id}>
        <th scope="row"><strong>{item.keyword || item.title}</strong><small>{item.title}</small><small>{item.site} · {item.country ?? "市场待核"} / {item.language ?? "语种待核"}</small>{item.topicId ? <Link className={styles.textLink} href={`/topics/${encodeURIComponent(item.topicId)}?site=${encodeURIComponent(item.site)}`}>对应话题 →</Link> : <small>话题关联待齐</small>}<small>{item.inQuarter ? "关联原季度成员，季度N不增加" : "热点额外批次，季度N不增加"}</small></th>
        <td><small>原始事件：{item.eventAt ?? "待核"}</small><small>有效至：{item.validUntil ?? "待核"}</small><EvidenceLinks label="官方证据" evidence={item.officialEvidence} /><EvidenceLinks label="独立需求证据" evidence={item.demandEvidence} /></td>
        <td><span className={styles.badge}>{item.admission?.status === "needs_topic_link" ? "话题关联待补" : item.admission?.status === "needs_research" ? "研究待补齐" : stages[item.stage] ?? item.stage}</span>{item.approvedAt ? <small>批准于 {item.approvedAt}</small> : null}{item.directionId ? <Link className={styles.task} href={`/opportunities#growth-direction-${encodeURIComponent(item.directionId)}`}>查看完整方向与决定 →</Link> : <small>完整方向卡尚未保存</small>}{item.admission ? <small>{item.admission.reason}</small> : null}{item.topicId && item.approvedAt && item.directionRevision && item.tasks.some(task => task.kind === "blog") && item.admission?.status !== "scheduled" && !["published", "reviewed", "expired", "rejected"].includes(item.stage) ? <FeedbackButton className={styles.more} disabled={Boolean(busy)} pending={busy === item.id} pendingLabel="正在核验原任务…" onClick={() => void retryAdmission(item)}>重新核验并追加原计划</FeedbackButton> : null}{messages[item.id] ? <small role="status">{messages[item.id]}</small> : null}</td>
        <td>{item.tasks?.length ? item.tasks.map(task => <div key={task.id}><Link className={styles.task} href={`/work/${encodeURIComponent(task.id)}`}>{task.title || task.id} ↗</Link><small>{statuses[task.status] ?? task.status} · 原交付日 {task.dueAt?.slice(0, 10) ?? "待核"}</small>{task.capacityClass === "authorized_hotspot_extra" ? <small>热点额外工作 · {task.inCurrentPlan ? "已在当周原计划" : "原计划追加待齐"}</small> : task.inCurrentPlan ? <small>复用当周原计划任务</small> : null}{task.pageUrl?.startsWith("https://") ? <SeoAnchor className={styles.textLink} href={task.pageUrl} target="_blank" rel="noreferrer">实际页面 ↗</SeoAnchor> : null}</div>) : <small>尚未登记可执行原任务，未冒称已排期。</small>}</td>
      </tr>)}</tbody></table></div>}
      {read.data ? <SeoTablePagination pagination={read.data.pagination} onPage={setPage} /> : null}
      {read.data ? <p className={styles.note}>记录更新于 {read.data.generatedAt}；研究、批准、登记、制作、发布与效果分阶段报告。</p> : null}
    </section>
    <GrowthQuarterReview />
  </>;
}
