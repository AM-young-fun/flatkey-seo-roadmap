"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { FeedbackButton } from "./FeedbackButton";
import { useSeoRead } from "./useSeoAnalytics";
import { SeoTablePagination } from "./SeoTablePagination";
import Link from "./AppLink";
import styles from "./GrowthTopicWorkspace.module.css";
import { SeoAnchor } from "@/components/SeoAnchor";
import type { GrowthHotspotItem } from "@/lib/growth-hotspots";
import type { HotspotTopicPage } from "@/lib/growth-hotspot-topics";

const stages: Record<string, string> = { needs_decision: "方向待定", approved: "方向已批准", scheduled: "已追加当周计划", in_progress: "制作中", published: "已发布", reviewed: "已复盘", expired: "已过有效期", rejected: "不采纳" };
const statuses: Record<string, string> = { planned: "已规划", researching: "研究中", in_progress: "进行中", completed: "已完成", published: "已发布", blocked: "受阻", paused: "已暂停", failed: "失败", review: "待审" };
const eventDate = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone: "Asia/Shanghai" });

function hotspotHref(listPage: number, topicKey?: string) {
  const query = new URLSearchParams({ tab: "hotspots" });
  if (listPage > 1) query.set("hotspotPage", String(listPage));
  if (topicKey) query.set("hotspotTopic", topicKey);
  return `/opportunities?${query}`;
}

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
export function GrowthHotspotWorkspace({ topicKey, listPage = 1 }: { topicKey?: string; listPage?: number }) {
  const [page, setPage] = useState(topicKey ? 1 : listPage);
  const query = new URLSearchParams({ view: "topics", page: String(page) });
  if (topicKey) query.set("topic", topicKey);
  const read = useSeoRead<HotspotTopicPage>(`/api/seo/growth/hotspots?${query}`);
  const data = read.data;
  const topic = data?.kind === "keywords" ? data.topic : null;
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
  return <section className={styles.panel} aria-label={topicKey ? "热点话题详情" : "近期热点话题"}>
    <div className={styles.sectionHeading}><div>
      {topicKey ? <Link className={styles.back} href={hotspotHref(listPage)}><ArrowLeft size={14} aria-hidden="true" />返回热点话题</Link> : null}
      <h2>{topic?.title ?? (topicKey ? "热点话题详情" : "近期热点话题")}</h2>
      {data ? <p>任务业务周 {data.businessWeek.start}—{data.businessWeek.end}（北京时间）</p> : null}
      {topic ? <p>{topic.site} · {topic.topicId ? "已关联 TopicMap" : "事件记录 · TopicMap 待关联"}</p> : null}
    </div></div>
    {read.error ? <p role="alert">热点记录读取失败：{read.error}<button className={styles.more} onClick={read.retry}>重试</button></p>
      : !data ? <p role="status">正在读取热点记录…</p>
      : data.kind === "topics" ? (data.topics.length ? <div className={styles.tableScroll}><table className={styles.table}>
        <thead><tr><th>话题</th><th>站点</th><th>热点词记录</th><th>关联原任务</th><th>最近事件或升温日期</th></tr></thead>
        <tbody>{data.topics.map(row => <tr key={row.key}>
          <th scope="row"><Link className={styles.topicName} href={hotspotHref(data.pagination.page, row.key)} prefetch={false}>{row.title}<ArrowUpRight size={14} aria-hidden="true" /></Link>{row.topicId ? null : <small>事件记录 · TopicMap 待关联</small>}</th>
          <td>{row.site}</td><td>{row.keywordCount}</td><td>{row.taskCount}</td><td><time dateTime={row.latestEventAt}>{eventDate.format(new Date(row.latestEventAt))}</time></td>
        </tr>)}</tbody>
      </table></div> : <p className={styles.empty}>当前没有已保存的热点研究记录。</p>)
      : !topic ? <p className={styles.empty}>未找到该热点话题。</p>
      : <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>原始热点词</th><th>事件与研究证据</th><th>方向与进度</th><th>关联原任务与页面</th></tr></thead><tbody>{data.items.map(item => <tr key={item.id}>
        <th scope="row"><strong>{item.keyword}</strong>{item.title !== topic.title && item.title !== item.keyword ? <small>{item.title}</small> : null}<small>{item.country ?? "市场待核"} / {item.language ?? "语种待核"}</small>{topic.topicId && item.quarterTargetId ? <Link className={styles.textLink} href={`/topics/${encodeURIComponent(topic.topicId)}?${new URLSearchParams({ site: item.site, target: item.quarterTargetId })}`}>对应季度关键词 →</Link> : null}</th>
        <td><small>事件或升温：{item.eventAt}</small><small>有效至：{item.validUntil}</small><EvidenceLinks label="官方证据" evidence={item.officialEvidence} /><EvidenceLinks label="独立需求证据" evidence={item.demandEvidence} /></td>
        <td><span className={styles.badge}>{item.admission.status === "needs_topic_link" ? "话题待关联" : item.admission.status === "needs_research" ? "研究待补齐" : stages[item.stage] ?? item.stage}</span>{item.approvedAt ? <small>批准于 {item.approvedAt}</small> : null}{item.directionId ? <Link className={styles.task} href={`/opportunities#growth-direction-${encodeURIComponent(item.directionId)}`}>查看原方向记录 →</Link> : null}<small>{item.admission.reason}</small>{topic.topicId && item.approvedAt && item.directionRevision && item.tasks.some(task => task.kind === "blog") && item.admission.status !== "scheduled" && !["published", "reviewed", "expired", "rejected"].includes(item.stage) ? <FeedbackButton className={styles.more} disabled={Boolean(busy)} pending={busy === item.id} pendingLabel="正在核验原任务…" onClick={() => void retryAdmission(item)}>重新核验并追加原计划</FeedbackButton> : null}{messages[item.id] ? <small role="status">{messages[item.id]}</small> : null}</td>
        <td>{item.tasks?.length ? item.tasks.map(task => <div key={task.id}><Link className={styles.task} href={`/work/${encodeURIComponent(task.id)}`}>{task.title || task.id} ↗</Link><small>{statuses[task.status] ?? task.status} · 原交付日 {task.dueAt?.slice(0, 10) ?? "待核"}</small>{task.capacityClass === "authorized_hotspot_extra" ? <small>热点额外工作 · {task.inCurrentPlan ? "已在当周原计划" : "原计划追加待齐"}</small> : task.inCurrentPlan ? <small>复用当周原计划任务</small> : null}{task.pageUrl?.startsWith("https://") ? <SeoAnchor className={styles.textLink} href={task.pageUrl} target="_blank" rel="noreferrer">实际页面 ↗</SeoAnchor> : null}</div>) : <small>尚未登记可执行原任务，未冒称已排期。</small>}</td>
      </tr>)}</tbody></table></div>}
    {data ? <SeoTablePagination pagination={data.pagination} onPage={setPage} /> : null}
  </section>;
}
