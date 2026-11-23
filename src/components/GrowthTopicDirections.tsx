"use client";

import type { GrowthStrategy } from "@/lib/growth-strategy";
import { useSeoRead } from "./useSeoAnalytics";
import Link from "./AppLink";
import styles from "./GrowthTopicDirections.module.css";

const decisions = { approve: "已批准当前范围", hold: "继续观察", reject: "不采纳" };
const metrics = { sessions: "自然搜索会话", clicks: "Google点击", impressions: "Google曝光" };
export function GrowthTopicDirections({ site, topicId, country = "all", language = "all" }: { site: string; topicId: string; country?: string; language?: string }) {
  const { data, error, retry } = useSeoRead<{ state: GrowthStrategy }>("/api/seo/growth/strategy");
  const directions = data?.state.directions.filter(direction => direction.scope.some(scope => scope.site === site && scope.topicId === topicId
    && (country === "all" || scope.country === country) && (language === "all" || scope.language === language)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3);
  return <section className={styles.root} aria-label="话题方向、涨跌原因与实验"><h2>方向与效果复盘</h2>
    {error ? <p role="alert">方向结论暂时无法读取。<button type="button" onClick={retry}>重新读取</button></p> : !data ? <p role="status">正在读取此话题的方向与实验…</p> : !directions?.length ? <p>当前站点、话题及市场尚无已存的方向结论，待补齐可比证据后再判断投入。</p> : directions.map(direction => {
      const drivers = direction.drivers.filter(driver => (driver.topicId === topicId || driver.topicId === null)
        && (country === "all" || driver.country === country) && (language === "all" || driver.language === language)).slice(0, 5);
      const taskIds = [...new Set([...direction.taskIds, ...drivers.flatMap(driver => driver.taskIds)])];
      return <article key={direction.id}><header><h3>{direction.title}</h3><span>{direction.decision ? decisions[direction.decision.decision] : "待人工审核"} · v{direction.revision}</span></header>
        <p><strong>方向假设：</strong>{direction.hypothesis}</p>
        {drivers.length ? drivers.map((driver, index) => <div className={styles.driver} key={`${driver.url}:${index}`}><a href={driver.url} target="_blank" rel="noreferrer">{driver.title} ↗</a><small>{driver.country} / {driver.language} · {driver.source} {metrics[driver.metric]}：{driver.previous} → {driver.current}（{driver.current > driver.previous ? "+" : ""}{driver.current - driver.previous}）{driver.topicId === null ? " · 方向级证据，未单独归属本话题" : ""}</small>{driver.window ? <small>本期 {driver.window.start}—{driver.window.end}；对比 {driver.window.previousStart}—{driver.window.previousEnd}（{driver.window.timezone}）</small> : null}<p>{driver.explanation}<span>{driver.limitation}</span></p><p>下一步：{driver.nextAction}</p></div>) : <p>尚无归属于当前筛选的页面涨跌证据；不把方向级判断视作本话题已验证效果。</p>}
        <p><strong>建议与实验：</strong>{direction.proposedAction}；指标：{direction.experiment.primaryMetric}；成功条件：{direction.experiment.successCondition}</p>
        <p><strong>下次检查：</strong>{new Date(direction.experiment.reviewAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}（北京时间）；{direction.experiment.adjustmentCondition}</p>
        <p className={styles.tasks}>方向关联原任务：{taskIds.length ? taskIds.slice(0, 5).map(id => <Link key={id} href={`/work/${encodeURIComponent(id)}`}>{id} ↗</Link>) : "尚未关联"}{taskIds.length > 5 ? `（另 ${taskIds.length - 5} 项见完整方案）` : ""}</p>
        <Link className={styles.review} href={`/#${encodeURIComponent(`growth-direction-${direction.id}`)}`}>查看 v{direction.revision} 完整方向与人工决定 →</Link>
      </article>;
    })}
  </section>;
}
