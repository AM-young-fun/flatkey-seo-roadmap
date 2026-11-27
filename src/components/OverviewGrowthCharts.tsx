"use client";
import type { OverviewKeywordSummary, OverviewTrafficGoal } from "@/lib/overview-summary";
import type { SeoReadState } from "./useSeoAnalytics";
import { BarPlot, ChartPanel, GoalPlot, chartNumber } from "./OverviewCharts";
import styles from "./OverviewCharts.module.css";
import topicStyles from "./GrowthTopicWorkspace.module.css";
import { reportDay } from "@/lib/seo-report-time.cjs";

const shortDay = (day: string) => `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;

export function OverviewGoalCharts({ traffic, keywords, trafficStatus, keywordStatus }: {
  traffic: OverviewTrafficGoal | null;
  keywords: OverviewKeywordSummary | null;
  trafficStatus?: React.ReactNode;
  keywordStatus?: React.ReactNode;
}) {
  const trafficValue = traffic?.sessions ?? traffic?.fallback?.sessions ?? null;
  const trafficDay = trafficValue === null ? null : traffic?.fallback?.end ?? traffic?.period.end;
  const { ranking, total } = keywords ?? { ranking: null, total: 0 };
  const rankingDay = ranking?.latestCheckedAt ? reportDay(new Date(ranking.latestCheckedAt)) : null;
  const dates = trafficDay && trafficDay === rankingDay ? [`数据截至 ${shortDay(trafficDay)}`] : [
    ...(trafficDay ? [`流量截至 ${shortDay(trafficDay)}`] : []), ...(rankingDay ? [`排名截至 ${shortDay(rankingDay)}`] : []),
  ];
  if (traffic) dates.unshift(`剩余 ${traffic.daysRemaining} 天`);
  const rollingPending = traffic?.mode === "rolling" && traffic.sessions === null;
  const fallback = traffic?.fallback;
  return <ChartPanel title="2026 收官季目标进度" note={dates.join(" · ")}>
    <div className={styles.grid}>
      <div>
        <GoalPlot label={fallback ? "Flatkey 最近已核验滚动7日自然搜索会话" : traffic?.mode === "final" ? "Flatkey 每周自然搜索会话" : "Flatkey 日常最新滚动7日自然搜索会话"}
          value={trafficValue} goal={3000} unit="次" empty={trafficStatus ? "暂无已读回会话数据" : undefined}
          note={rollingPending ? `洛杉矶 ${shortDay(traffic.period.end)} 截止窗口待采${fallback ? `，当前显示 ${shortDay(fallback.start)}–${shortDay(fallback.end)} 的整段会话` : ""}。` : undefined} />
        {trafficStatus}
      </div>
      <div>
        <GoalPlot label="全部关键词前100覆盖" value={ranking && total ? ranking.total / total * 100 : null} goal={60} unit="%"
          denominator={ranking && total ? `${chartNumber(ranking.total)} / ${chartNumber(total)} 词` : undefined}
          empty={keywords ? "暂无可核实的排名覆盖" : "等待全部关键词数据"} />
        {keywordStatus}
      </div>
      <GoalPlot label="已获排名关键词中前50" value={ranking?.total ? ranking.top50 / ranking.total * 100 : null} goal={80} unit="%"
        denominator={ranking?.total ? `${chartNumber(ranking.top50)} / ${chartNumber(ranking.total)} 词` : undefined}
        empty={ranking ? "暂无已确认前100排名" : "暂无排名汇总"} />
    </div>
  </ChartPanel>;
}

const workStates = [["completed", "已有公开页"], ["in_progress", "制作中"], ["scheduled", "已排期"], ["researching", "研究中"], ["planned", "已规划"], ["unknown", "进度待核"]] as const;

function ContentProgress({ data }: { data: OverviewKeywordSummary }) {
  return <ChartPanel title="全部关键词内容建设进度" note={data.total ? `${chartNumber(data.total)} 个关键词，同词按最靠前的建设阶段统计。` : undefined}>
    <BarPlot rows={data.total ? workStates.map(([state, label]) => ({ label, value: data.workCounts[state], color: state === "completed" ? "#32aa8b" : state === "unknown" ? "#b1bdcd" : undefined })) : []}
      unit="词" showAxis={false} empty="暂无可核实的建设进度" />
  </ChartPanel>;
}

export function OverviewReadFailure({ title, error, retry }: { title: string; error: string; retry: () => void }) {
  return <ChartPanel title={title} note="">
    <div className="loadError" role="alert"><span>{error}</span><button type="button" onClick={retry}>重新加载</button></div>
  </ChartPanel>;
}

export function OverviewGoalSection({ traffic, growth }: {
  traffic: SeoReadState<OverviewTrafficGoal>;
  growth: SeoReadState<OverviewKeywordSummary>;
}) {
  return <OverviewGoalCharts traffic={traffic.data} keywords={growth.data}
    trafficStatus={traffic.error ? <div className="loadError" role="alert"><span>{traffic.error}</span><button type="button" onClick={traffic.retry}>重新加载</button></div>
      : traffic.loading ? <p role="status">正在读取季度流量目标…</p> : undefined}
    keywordStatus={growth.error ? <div className="loadError" role="alert"><span>{growth.error}</span><button type="button" onClick={growth.retry}>重新加载</button></div> : undefined} />;
}

export function OverviewContentSection({ growth }: { growth: SeoReadState<OverviewKeywordSummary> }) {
  return growth.data ? <ContentProgress data={growth.data} />
    : growth.loading ? <ChartPanel title="全部关键词内容建设进度"><p role="status">正在读取建设进度…</p></ChartPanel>
    : <OverviewReadFailure title="全部关键词内容建设进度" error={growth.error ?? "建设进度未返回，请重试"} retry={growth.retry} />;
}

export function GrowthRankingCoverage({ read }: { read: Pick<SeoReadState<OverviewKeywordSummary>, "data" | "error" | "retry"> }) {
  const { data, error, retry } = read;
  const title = "当前有效关键词排名";
  if (error) return <OverviewReadFailure title={title} error={error} retry={retry} />;
  if (!data) return <ChartPanel title={title}><p role="status">正在读取有效排名…</p></ChartPanel>;
  const summary = data.coverage;
  if (!summary) return <OverviewReadFailure title={title} error="近期 SERP 暂时无法读取。" retry={retry} />;
  return <section className={topicStyles.panel} aria-label="当前有效关键词排名汇总">
    <div className={topicStyles.sectionHeading}>
      <div><h2>当前有效关键词排名</h2><p>统计全部关键词中已确认的前 100 排名，同一个词只计一次。</p></div>
    </div>
    <BarPlot rows={[{ label: "已获排名关键词", value: summary.total }, { label: "其中前50关键词", value: summary.top50 }]} unit="个原词" showAxis={false} />
    <div className={topicStyles.coverageGrid}><section><h3>有效前100关键词：国家 / 地区占比</h3><BarPlot rows={summary.markets.map(market => ({ label: market.label, value: market.share === null ? null : market.share * 100, suffix: `${market.count}词 · ${market.share === null ? "—" : `${(market.share * 100).toFixed(1)}%`}` }))} unit="%" denominator={`${summary.total}个已证实有效前100原词`} empty="尚无有效排名，国家占比暂不可计算" /></section>
      <section><h3>有效前100关键词：排名区间占比</h3><BarPlot rows={summary.bands.map(band => ({ label: band.label, value: band.share === null ? null : band.share * 100, suffix: `${band.count}词 · ${band.share === null ? "—" : `${(band.share * 100).toFixed(1)}%`}` }))} unit="%" denominator={`${summary.total}个已证实有效前100原词`} empty="尚无有效排名，区间占比暂不可计算" /></section></div>
    {data.partial ? <p className={topicStyles.note}>部分来源暂未读齐。</p> : null}
  </section>;
}
