"use client";

import { useEffect, useRef, useState } from "react";
import Link from "@/components/AppLink";
import type { OverviewProgress } from "@/lib/seo-overview-progress";
import { ChartPanel, chartNumber } from "./OverviewCharts";
import { SeoAnchor } from "./SeoAnchor";
import { SeoIndexing404 } from "./SeoIndexing404";
import { useOverviewRead } from "./useSeoAnalytics";
import styles from "./OverviewExecutionProgress.module.css";

const progressUrl = "/api/seo/overview-progress";

function RecentWork({ work }: { work: NonNullable<OverviewProgress["work"]> }) {
  const query = new URLSearchParams({ range: "custom", rangeStart: work.start, rangeEnd: work.end, status: "all" });
  return <>
    <div className={styles.summary}>
      <dl>
        <div><dt>到期任务</dt><dd>{chartNumber(work.due)}</dd></div>
        <div><dt>已完成</dt><dd>{chartNumber(work.complete)}</dd></div>
        <div><dt>处理中</dt><dd>{chartNumber(work.inProgress)}</dd></div>
        <div><dt>待开始</dt><dd>{chartNumber(work.scheduled)}</dd></div>
        <div><dt>阻塞</dt><dd>{chartNumber(work.blocked)}</dd></div>
      </dl>
      <Link href={`/work?${query}`}>查看工作任务</Link>
    </div>
    {work.due > 0 && <>
      <progress aria-label="已完成的到期任务" value={work.complete} max={work.due} />
      <div className={styles.scroll}>
        <table aria-label="近七天任务逐日进度">
          <thead><tr><th scope="col">交付日</th><th scope="col">到期</th><th scope="col">完成</th><th scope="col">未完成</th></tr></thead>
          <tbody>{work.rows.map(day => <tr key={day.date}><th scope="row"><time dateTime={day.date}>{day.date.slice(5)}</time></th>
            <td>{day.due}</td><td>{day.complete}</td><td>{day.due - day.complete}</td></tr>)}</tbody>
        </table>
      </div>
    </>}
    <p className={styles.note}>按北京时间 {work.start} 至 {work.end} 的已到期正式制作和优化任务统计，完成以验收为准。</p>
  </>;
}

function EffectComparison({ before, after }: { before?: number; after?: number }) {
  if (before == null || after == null) return <span className={styles.note}>待对比</span>;
  const delta = after - before;
  return <><span>{chartNumber(before)} → {chartNumber(after)}</span><small data-direction={delta > 0 ? "up" : delta < 0 ? "down" : undefined}>
    {delta ? delta.toLocaleString("zh-CN", { signDisplay: "always" }) : "持平"}</small></>;
}

function RecentEffects({ effects }: { effects: NonNullable<OverviewProgress["effects"]> }) {
  return <>
    <div className={styles.summary}><p>{effects.total} 个已验收页面 · {effects.comparable} 个有可对比的搜索数据</p>
      <Link href="/optimization-effects">查看全部优化效果</Link></div>
    {effects.pages.length > 0 && <div className={styles.scroll}>
      <table aria-label="近期优化页面效果">
        <thead><tr><th scope="col">页面与上线日</th><th scope="col">Google 点击</th><th scope="col">Google 展示</th><th scope="col">自然搜索会话</th></tr></thead>
        <tbody>{effects.pages.map(page => <tr key={page.url}>
          <th scope="row"><SeoAnchor href={page.url}>{page.title}</SeoAnchor><small>上线 {page.day}
            {page.before && page.latest ? ` · GSC ${page.before.date} / ${page.latest.date}` : ""}</small></th>
          <td><EffectComparison before={page.before?.clicks} after={page.latest?.clicks} /></td>
          <td><EffectComparison before={page.before?.impressions} after={page.latest?.impressions} /></td>
          <td><EffectComparison before={page.beforeVisits?.visits} after={page.latestVisits?.visits} /></td>
        </tr>)}</tbody>
      </table>
    </div>}
    <p className={styles.note}>上线范围为洛杉矶时间 {effects.start} 至 {effects.end}。前后各取最近已归档的可比日。</p>
  </>;
}

export function OverviewExecutionProgress() {
  const section = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (location.hash === "#seo-indexing-404" || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const target = section.current;
    if (!target) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "420px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  const { data, error, retry, loading } = useOverviewRead<OverviewProgress>(visible ? progressUrl : null);
  const unavailable = (message: string) => error || data ?
    <div className="loadError" role="alert"><span>{message}</span><button type="button" onClick={retry}>重新加载</button></div> :
    <p className={styles.note} role={loading ? "status" : undefined}>正在读取生产记录…</p>;
  return <div ref={section} className={styles.stack}>
    <ChartPanel title="近七天任务完成进度" className={styles.panel}>
      {data?.work ? <RecentWork work={data.work} /> : unavailable("任务进度暂时无法读取。")}
    </ChartPanel>
    {visible ? <SeoIndexing404 title="GSC 404 修复进度" /> : <ChartPanel title="GSC 404 修复进度"><p className={styles.note}>正在读取巡检记录…</p></ChartPanel>}
    <ChartPanel title="近期优化效果" className={styles.panel}>
      {data?.effects ? <RecentEffects effects={data.effects} /> : unavailable("优化效果暂时无法读取。")}
    </ChartPanel>
  </div>;
}
