"use client";
import type { GrowthReportSnapshot } from "@/lib/growth-strategy";
import type { GrowthWorkspace } from "@/lib/growth-types";
import type { SeoReadState } from "./useSeoAnalytics";
import { growthWordKey } from "@/lib/growth-workspace";
import { currentRankingSummary } from "@/lib/current-ranking-summary";
import { BarPlot, ChartPanel, GoalPlot, chartNumber } from "./OverviewCharts";
import styles from "./OverviewCharts.module.css";
import { reportDay } from "@/lib/seo-report-time.cjs";

const shortDay = (day: string) => `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;

export function OverviewGoalCharts({ snapshot, workspace }: { snapshot: GrowthReportSnapshot; workspace?: GrowthWorkspace | null }) {
  const g = snapshot.goals;
  const trafficDay = g.trafficScope && g.weeklySessions !== null ? g.trafficPeriod.end : null;
  const total = new Set(workspace?.targets.map(row => growthWordKey(row.keyword)).filter(Boolean)).size;
  const rankSourceReady = workspace && !workspace.reconciliation.sources.some(source => source.name === "最近14天的已存SERP" && !source.available);
  const ranking = rankSourceReady ? currentRankingSummary(workspace.targets, workspace.generatedAt) : null;
  const latestRankAt = ranking?.selected.flatMap(target => target.checkedAt ? [target.checkedAt] : []).sort().at(-1);
  const rankingDay = latestRankAt ? reportDay(new Date(latestRankAt)) : null;
  const dates = trafficDay && trafficDay === rankingDay ? [`数据截至 ${shortDay(trafficDay)}`] : [
    ...(trafficDay ? [`流量截至 ${shortDay(trafficDay)}`] : []), ...(rankingDay ? [`排名截至 ${shortDay(rankingDay)}`] : []),
  ];
  return <ChartPanel title="2026 收官季目标进度" note={[`剩余 ${g.daysRemaining} 天`, ...dates].join(" · ")}>
    <div className={styles.grid}>
      <GoalPlot label={g.trafficWindowKind === "rolling7day-v1" ? "Flatkey 日常最新滚动7日自然搜索会话" : "Flatkey 每周自然搜索会话"} value={g.trafficScope ? g.weeklySessions : null} goal={3000} unit="次" />
      <GoalPlot label="全部关键词前100覆盖" value={ranking && total ? ranking.total / total * 100 : null} goal={60} unit="%"
        denominator={ranking && total ? `${chartNumber(ranking.total)} / ${chartNumber(total)} 词` : undefined}
        empty={workspace ? "暂无可核实的排名覆盖" : "等待全部关键词数据"} />
      <GoalPlot label="已获排名关键词中前50" value={ranking?.total ? ranking.top50 / ranking.total * 100 : null} goal={80} unit="%"
        denominator={ranking?.total ? `${chartNumber(ranking.top50)} / ${chartNumber(ranking.total)} 词` : undefined} empty="暂无已确认前100排名" />
    </div>
  </ChartPanel>;
}
const workStates = [["completed", "已有公开页"], ["in_progress", "制作中"], ["scheduled", "已排期"], ["researching", "研究中"], ["planned", "已规划"], ["unknown", "进度待核"]] as const;
const workPriority = new Map(workStates.map(([state], index) => [state, index]));

function ContentProgress({ workspace }: { workspace: GrowthWorkspace }) {
  const words = new Map<string, GrowthWorkspace["targets"][number]["workState"]>();
  for (const row of workspace.targets) {
    const key = growthWordKey(row.keyword), previous = words.get(key);
    if (key && (!previous || workPriority.get(row.workState)! < workPriority.get(previous)!)) words.set(key, row.workState);
  }
  const counts = new Map(workStates.map(([state]) => [state, 0]));
  for (const state of words.values()) counts.set(state, counts.get(state)! + 1);
  return <ChartPanel title="全部关键词内容建设进度" note={words.size ? `${chartNumber(words.size)} 个关键词，同词按最靠前的建设阶段统计。` : undefined}>
    <BarPlot rows={words.size ? workStates.map(([state, label]) => ({ label, value: counts.get(state)!, color: state === "completed" ? "#32aa8b" : state === "unknown" ? "#b1bdcd" : undefined })) : []}
      unit="词" showAxis={false} empty="暂无可核实的建设进度" />
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
    {strategy.data?.snapshot ? <OverviewGoalCharts snapshot={strategy.data.snapshot} workspace={growth.data} />
      : strategy.loading ? <ChartPanel title="2026 收官季目标进度" note=""><p role="status">正在重读季度目标…</p></ChartPanel>
      : <OverviewReadFailure title="2026 收官季目标进度" error={strategy.error ?? "季度目标未返回，请重试"} retry={strategy.retry} />}
    {growth.data ? <ContentProgress workspace={growth.data} />
      : growth.loading ? <ChartPanel title="全部关键词内容建设进度" note=""><p role="status">正在重读建设进度…</p></ChartPanel>
      : <OverviewReadFailure title="全部关键词内容建设进度" error={growth.error ?? "建设进度未返回，请重试"} retry={growth.retry} />}
  </>;
}
