"use client";
import type { OverviewKeywordSummary, OverviewTrafficGoal } from "@/lib/overview-summary";
import type { SeoReadState } from "./useSeoAnalytics";
import { BarPlot, ChartPanel, GoalPlot, LinePlot, chartNumber } from "./OverviewCharts";
import styles from "./OverviewCharts.module.css";
import topicStyles from "./GrowthTopicWorkspace.module.css";
import { CLOSEOUT_CORE_BASELINE, CLOSEOUT_TRAFFIC_TARGET, ORDINARY_COVERAGE_GOAL, closeoutCoreGoals, closeoutCoreKeywords, closeoutTrafficMilestones } from "@/lib/seo-quarter-targets";
import { SeoAnchor } from "./SeoAnchor";

const shortDay = (day: string) => `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;

export function OverviewGoalCharts({ traffic, keywords, trafficStatus, keywordStatus }: {
  traffic: OverviewTrafficGoal | null;
  keywords: OverviewKeywordSummary | null;
  trafficStatus?: React.ReactNode;
  keywordStatus?: React.ReactNode;
}) {
  const sessions = traffic?.sessions ?? traffic?.fallback?.sessions ?? null;
  const daily = sessions === null ? null : sessions / 7;
  const trafficDay = sessions === null ? null : traffic?.fallback?.end ?? traffic?.period.end;
  const rollingPending = traffic?.mode === "rolling" && traffic.sessions === null;
  const fallback = traffic?.fallback;
  const milestones = traffic?.milestones ?? closeoutTrafficMilestones.map(week => ({ ...week, actual: null }));
  const observed = milestones.find(week => week.end === traffic?.activeMilestoneEnd);
  const currentWeek = observed ?? milestones[0];
  const core = keywords?.core ?? closeoutCoreKeywords.map(word => ({
    keyword: word.keyword, country: word.country, language: word.language, url: "https://flatkey.ai" + word.path,
    rank: null, rankObservedAt: null, rankTarget: word.rankTarget, goal: closeoutCoreGoals(word), metrics: null,
    baseline: "baseline" in word ? word.baseline : null,
  }));
  const measured = core.filter(word => word.rank !== null).length;
  const reached = core.filter(word => word.rank !== null && word.rank <= word.rankTarget).length;
  const note = [traffic ? `剩余 ${traffic.daysRemaining} 天` : null, trafficDay ? `流量截至 ${shortDay(trafficDay)}` : null].filter(Boolean).join(" · ");
  return <ChartPanel title="2026 收官季目标进度" note={note}>
    <div className={styles.two}>
      <div>
        <GoalPlot label="Flatkey 日均自然搜索会话（最近 7 个完整日）"
          value={daily} goal={CLOSEOUT_TRAFFIC_TARGET} unit="次/天"
          note={rollingPending ? `洛杉矶 ${shortDay(traffic.period.end)} 截止窗口待采${fallback ? `，当前显示 ${shortDay(fallback.start)}–${shortDay(fallback.end)} 日均` : ""}。` : undefined} />
        {trafficStatus}
        <p className={styles.note}>本周目标 {chartNumber(currentWeek.target)} 次/天 · 统计周为洛杉矶周四至周三</p>
        <details className={styles.closeoutDetails}>
          <summary>查看周目标与实际</summary>
          <LinePlot rows={milestones.map(week => ({ label: week.end, value: week.actual, prior: week.target }))} unit="次/天" series={["实际日均", "周目标"]} />
          <table><thead><tr><th scope="col">统计周</th><th scope="col">目标日均</th><th scope="col">实际日均</th></tr></thead><tbody>
            {milestones.map(week => <tr key={week.start}><td>{week.start} – {week.end}</td><td>{chartNumber(week.target)}</td><td>{chartNumber(week.actual)}</td></tr>)}
          </tbody></table>
        </details>
      </div>
      <div>
        <GoalPlot label="核心关键词达到各自排名目标" value={measured ? reached : null} goal={core.length} unit="词"
          note={`已核排名 ${measured} / ${core.length} 词。近 28 天表现逐词列示。`} empty="暂无有效的同市场排名" />
        {keywordStatus}
      </div>
    </div>
    <div className={styles.closeoutTable}>
      <table aria-label="核心关键词季度目标">
        <thead><tr><th scope="col">核心原词与承接页</th><th scope="col">市场</th><th scope="col">同市场排名</th><th scope="col">展示</th><th scope="col">点击</th><th scope="col">CTR</th></tr></thead>
        <tbody>{core.map(word => <tr key={word.country + word.keyword}>
          <th scope="row"><SeoAnchor href={word.url}>{word.keyword}</SeoAnchor></th>
          <td>{word.country} · {word.language}</td><td>{word.rank ?? "—"} / 前 {word.rankTarget}</td>
          <td>{chartNumber(word.metrics?.impressions)} / {chartNumber(word.goal.impressions)}{word.baseline && <small>基线 {chartNumber(word.baseline.impressions)}</small>}</td>
          <td>{chartNumber(word.metrics?.clicks)} / {chartNumber(word.goal.clicks)}{word.baseline && <small>基线 {chartNumber(word.baseline.clicks)}</small>}</td>
          <td>{word.metrics?.ctr == null ? "—" : `${chartNumber(word.metrics.ctr)}%`} / {word.goal.ctr === null ? "—" : `${chartNumber(word.goal.ctr)}%`}</td>
        </tr>)}</tbody>
      </table>
      <p className={styles.note}>各列为实际 / 季度目标。展示、点击和 CTR 使用同市场、同原词、同规范页近 28 日完整证据。基线为 {CLOSEOUT_CORE_BASELINE.start} 至 {CLOSEOUT_CORE_BASELINE.end}。</p>
    </div>
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
  const ordinary = growth.data?.ordinary;
  if (!ordinary) return growth.error ? <OverviewReadFailure title="普通关键词覆盖" error={growth.error} retry={growth.retry} />
    : <ChartPanel title="普通关键词覆盖"><p role="status">{growth.loading ? "正在读取正式排期和上线回执…" : "覆盖证据待核。"}</p></ChartPanel>;
  const value = ordinary.due ? ordinary.covered / ordinary.due * 100 : null;
  return <ChartPanel title="普通关键词覆盖" note={`截至 ${ordinary.through} 到期的普通主词 · 季末目标 ${ORDINARY_COVERAGE_GOAL}%`}>
    <GoalPlot label="已由正式上线页覆盖" value={value} goal={ORDINARY_COVERAGE_GOAL} unit="%"
      denominator={`${ordinary.covered} / ${ordinary.due} 已排应交付词`} />
    <details className={styles.closeoutDetails} open>
      <summary>各站点与市场的交付进度</summary>
      <div className={styles.closeoutTable}><table>
        <thead><tr><th scope="col">站点</th><th scope="col">国家／地区</th><th scope="col">应交付</th><th scope="col">已覆盖</th><th scope="col">待完成</th></tr></thead>
        <tbody>{ordinary.groups.map(row => <tr key={row.site + row.country}><td>{row.site}</td><td>{row.country}</td><td>{row.due}</td><td>{row.covered}</td><td>{row.due - row.covered}</td></tr>)}</tbody>
      </table></div>
    </details>
    <details className={styles.closeoutDetails}>
      <summary>Flatkey 季度市场配额与待排名额</summary>
      <div className={styles.closeoutTable}><table>
        <thead><tr><th scope="col">国家／地区</th><th scope="col">计划占比</th><th scope="col">配额</th><th scope="col">已排</th><th scope="col">待排</th></tr></thead>
        <tbody>{ordinary.markets.map(row => <tr key={row.country}><td>{row.label}</td><td>{row.share}%</td><td>{row.target}</td><td>{row.assigned}</td><td>{row.open}</td></tr>)}</tbody>
      </table></div>
    </details>
  </ChartPanel>;
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
