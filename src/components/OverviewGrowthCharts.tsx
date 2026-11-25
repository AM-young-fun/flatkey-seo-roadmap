"use client";
import type { GrowthReportSnapshot } from "@/lib/growth-strategy";
import type { GrowthWorkspace } from "@/lib/growth-types";
import type { SeoReadState } from "./useSeoAnalytics";
import { quarterTargetWorkspace } from "./growth-topic-view";
import { BarPlot, ChartPanel, GoalPlot } from "./OverviewCharts";
import styles from "./OverviewCharts.module.css";
import { SeoAnchor } from "@/components/SeoAnchor";
import { reportDay } from "@/lib/seo-report-time.cjs";

const shortDay = (day: string) => `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;

export function OverviewGoalCharts({ snapshot }: { snapshot: GrowthReportSnapshot }) {
  const g = snapshot.goals;
  const trafficDay = g.trafficScope && g.weeklySessions !== null ? g.trafficPeriod.end : null;
  const rankingDay = g.latestRankAt && Number.isFinite(Date.parse(g.latestRankAt)) ? reportDay(new Date(g.latestRankAt)) : null;
  const dates = trafficDay && trafficDay === rankingDay ? [`数据截至 ${shortDay(trafficDay)}`] : [
    ...(trafficDay ? [`流量截至 ${shortDay(trafficDay)}`] : []), ...(rankingDay ? [`排名截至 ${shortDay(rankingDay)}`] : []),
  ];
  return <ChartPanel title="2026 收官季目标进度" note={[`剩余 ${g.daysRemaining} 天`, ...dates].join(" · ")}>
    <div className={styles.grid}>
      <GoalPlot label={g.trafficWindowKind === "rolling7day-v1" ? "Flatkey 日常最新滚动7日自然搜索会话" : "Flatkey 每周自然搜索会话"} value={g.trafficScope ? g.weeklySessions : null} goal={3000} unit="次" />
      <GoalPlot label="季度关键词前100覆盖" value={g.baselineCount !== null && g.coverage !== null ? g.coverage * 100 : null} goal={60} unit="%" empty={g.baselineCount === null ? "季度清单尚未核定" : "暂无有效前100数据"} />
      <GoalPlot label="已获排名关键词中前50" value={g.quality === null ? null : g.quality * 100} goal={80} unit="%" />
    </div>
  </ChartPanel>;
}
function ContentProgress({ workspace }: { workspace: GrowthWorkspace | null }) {
  const rows = workspace ? quarterTargetWorkspace(workspace).targets : [];
  const states = [["completed", "已有公开页"], ["in_progress", "制作中"], ["scheduled", "已排期"], ["researching", "研究中"], ["planned", "已规划"], ["unknown", "进度待核"]] as const;
  return <ChartPanel title="季度内容建设进度">
    <BarPlot rows={workspace && rows.length ? states.map(([state, label]) => ({ label, value: rows.filter(row => row.workState === state).length, color: state === "completed" ? "#32aa8b" : state === "unknown" ? "#b1bdcd" : undefined })) : []} unit="词" showAxis={false} empty="季度成员或进度来源尚未齐全，暂不绘制" />
    <SeoAnchor className={styles.link} href="/opportunities">查看话题与关键词进度 →</SeoAnchor>
  </ChartPanel>;
}

export function OverviewReadFailure({ title, error, retry }: { title: string; error: string; retry: () => void }) {
  return <ChartPanel title={title} note="">
    <div className="loadError" role="alert"><span>{error}</span><button type="button" onClick={retry}>重新加载</button></div>
  </ChartPanel>;
}

export function OverviewGrowthCharts({ strategy, growth }: {
  strategy: SeoReadState<{ snapshot: GrowthReportSnapshot }>;
  growth: SeoReadState<GrowthWorkspace>;
}) {
  return <>
    {strategy.data?.snapshot ? <OverviewGoalCharts snapshot={strategy.data.snapshot} />
      : strategy.loading ? <ChartPanel title="2026 收官季目标进度" note=""><p role="status">正在重读季度目标…</p></ChartPanel>
      : <OverviewReadFailure title="2026 收官季目标进度" error={strategy.error ?? "季度目标未返回，请重试"} retry={strategy.retry} />}
    {growth.data ? <ContentProgress workspace={growth.data} />
      : growth.loading ? <ChartPanel title="季度内容建设进度" note=""><p role="status">正在重读建设进度…</p></ChartPanel>
      : <OverviewReadFailure title="季度内容建设进度" error={growth.error ?? "建设进度未返回，请重试"} retry={growth.retry} />}
  </>;
}
