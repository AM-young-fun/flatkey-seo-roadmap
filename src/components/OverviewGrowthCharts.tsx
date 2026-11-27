"use client";
import type { OverviewKeywordSummary, OverviewTrafficGoal } from "@/lib/overview-summary";
import type { SeoReadState } from "./useSeoAnalytics";
import { BarPlot, ChartPanel, GoalPlot, LinePlot, chartNumber } from "./OverviewCharts";
import styles from "./OverviewCharts.module.css";
import closeout from "./OverviewCloseout.module.css";
import { CLOSEOUT_CORE_BASELINE, CLOSEOUT_TRAFFIC_TARGET, ORDINARY_COVERAGE_GOAL, closeoutCoreGoals, closeoutCoreKeywords, closeoutTrafficMilestones } from "@/lib/seo-quarter-targets";
import { SeoAnchor } from "./SeoAnchor";
import { shiftDay } from "@/lib/seo-date-range";

const shortDay = (day: string) => `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;

export function OverviewGoalCharts({ traffic, keywords, trafficStatus, keywordStatus }: {
  traffic: OverviewTrafficGoal | null;
  keywords: OverviewKeywordSummary | null;
  trafficStatus?: React.ReactNode;
  keywordStatus?: React.ReactNode;
}) {
  const rollingPending = traffic?.mode === "rolling" && traffic.sessions === null;
  const fallback = rollingPending ? traffic.fallback : null;
  const window = fallback ?? traffic?.period;
  const sessions = traffic?.sessions ?? fallback?.sessions ?? null;
  const daily = sessions === null ? null : sessions / 7;
  const trafficDay = daily !== null ? window?.end : null;
  const milestones = traffic?.milestones ?? closeoutTrafficMilestones.map(week => ({ ...week, actual: null }));
  const referenceDay = traffic?.mode === "rolling" ? shiftDay(traffic.period.end, 1) : traffic?.period.end;
  const currentWeek = milestones.find(week => week.end === traffic?.activeMilestoneEnd)
    ?? (referenceDay ? milestones.find(week => week.start <= referenceDay && week.end >= referenceDay) : undefined);
  const core = keywords?.core ?? closeoutCoreKeywords.map(word => ({
    keyword: word.keyword, country: word.country, language: word.language, url: "https://flatkey.ai" + word.path,
    rank: null, rankObservedAt: null, rankTarget: word.rankTarget, goal: closeoutCoreGoals(word), metrics: null, otherPages: [], queryCheckedThrough: null,
    baseline: "baseline" in word ? word.baseline : null,
  }));
  const measured = core.filter(word => word.rank !== null).length;
  const reached = core.filter(word => word.rank !== null && word.rank <= word.rankTarget).length;
  const progress = daily === null ? null : daily / CLOSEOUT_TRAFFIC_TARGET * 100;
  const note = [traffic ? `剩余 ${traffic.daysRemaining} 天` : null, trafficDay ? `流量截至 ${shortDay(trafficDay)}` : null].filter(Boolean).join(" · ");

  return <ChartPanel title="2026 收官季目标进度" note={note} className={closeout.panel}>
    <div className={closeout.summary}>
      <section className={closeout.traffic} aria-labelledby="closeout-traffic">
        <h3 id="closeout-traffic">Flatkey 日均自然搜索会话</h3>
        <dl className={closeout.trafficStats}>
          <div><dt>{traffic?.mode === "final" ? "季末实绩" : fallback ? "上次归档 7 日实际" : "最近 7 日实际"}</dt>
            <dd className={closeout.primaryValue}>{daily === null ? <small>待采集</small> : <>{chartNumber(daily)} <small>次/天</small></>}</dd></div>
          <div><dt>{traffic?.mode === "final" ? "最后一周目标" : "本周目标"}</dt>
            <dd>{currentWeek ? <>{chartNumber(currentWeek.target)} <small>次/天</small></> : <small>待进入统计周</small>}</dd>
            {currentWeek && <p>{shortRange(currentWeek.start, currentWeek.end)}</p>}</div>
          <div><dt>季度目标</dt><dd>{chartNumber(CLOSEOUT_TRAFFIC_TARGET)} <small>次/天</small></dd></div>
        </dl>
        {progress != null && daily != null && <div className={closeout.progress}>
          <div><span>季度目标达成率 <b>{chartNumber(progress)}%</b></span>
            <span>{daily >= CLOSEOUT_TRAFFIC_TARGET ? "已达季度目标" : `距目标 ${chartNumber(CLOSEOUT_TRAFFIC_TARGET - daily)} 次/天`}</span></div>
          <progress aria-label="季度流量目标达成率" max={CLOSEOUT_TRAFFIC_TARGET} value={Math.min(daily, CLOSEOUT_TRAFFIC_TARGET)} />
        </div>}
        {rollingPending ? <p className={closeout.context}>洛杉矶 {shortDay(traffic.period.end)} 截止窗口待采{fallback && `，当前显示 ${shortRange(fallback.start, fallback.end)} 日均`}。</p>
          : trafficDay && window && <p className={closeout.context}>洛杉矶 {shortRange(window.start, window.end)} · 7 个完整自然日</p>}
        {trafficStatus}
      </section>
      <section className={closeout.ranking} aria-labelledby="closeout-ranking">
        <h3 id="closeout-ranking">核心关键词排名目标</h3>
        <div className={closeout.rankHeadline}><strong>{measured ? chartNumber(reached) : core.length}</strong>
          <span>{measured ? ` / ${core.length} 词已达标` : " 词排名待核验"}</span></div>
        {measured > 0 && <dl className={closeout.rankStats}>
          <div><dt>已核排名</dt><dd>{measured} 词</dd></div>
          <div><dt>待核排名</dt><dd>{core.length - measured} 词</dd></div>
        </dl>}
        <SeoAnchor className={closeout.jump} href="#closeout-keywords">查看 {core.length} 个核心词明细 <span aria-hidden="true">↓</span></SeoAnchor>
        {keywordStatus}
      </section>
    </div>
    <details className={closeout.weekly} open>
      <summary>预估周目标与实际</summary>
      <p className={closeout.context}>洛杉矶周四至周三 · 每个完整统计周的日均会话</p>
      <div className={closeout.weeklyBody}>
        <div>
          <LinePlot rows={milestones.map(week => ({ label: week.end, value: week.actual, prior: week.target }))}
            unit="次/天" series={["实际日均", "周目标"]} interval="周" />
          {milestones.every(week => week.actual === null) && <p className={closeout.context}>暂无完整统计周的实际值。</p>}
        </div>
        <table className={closeout.weeks} aria-label="各周日均流量目标与实际">
          <thead><tr><th scope="col">统计周</th><th scope="col">目标</th><th scope="col">实际</th></tr></thead>
          <tbody>{milestones.map(week => <tr key={week.start} data-current={week === currentWeek || undefined}>
            <th scope="row"><time dateTime={week.start}>{shortDay(week.start)}</time>–<time dateTime={week.end}>{shortDay(week.end)}</time>
              {week === currentWeek && traffic?.mode === "rolling" && <small>本周</small>}</th>
            <td>{chartNumber(week.target)}</td>
            <td>{week.actual !== null ? chartNumber(week.actual) : <span className={closeout.pending}>
              {referenceDay && week.start > referenceDay ? "未到期" : week === currentWeek && traffic?.mode === "rolling" ? "进行中" : referenceDay ? "待采集" : "—"}</span>}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>

    <section className={closeout.keywords} aria-labelledby="closeout-keywords">
      <h3 id="closeout-keywords">核心关键词明细</h3>
      <p className={closeout.context}>每列上方是实际表现，下方是季度目标。展示、点击和 CTR 取同市场原词及承接页近 28 日的 GSC 数据。</p>
      <p className={closeout.scrollHint}>横向滑动可查看全部指标。</p>
      <div className={closeout.tableWrap} tabIndex={0} role="region" aria-label="核心关键词明细表">
        <table className={closeout.coreTable} aria-label="核心关键词季度目标">
          <thead><tr><th scope="col">核心原词与承接页</th><th scope="col">市场</th><th scope="col">同市场排名</th><th scope="col">展示</th><th scope="col">点击</th><th scope="col">CTR</th></tr></thead>
          <tbody>{core.map(word => <tr key={word.country + word.keyword}>
            <th scope="row"><SeoAnchor href={word.url}>{word.keyword}<small>{word.url.replace("https://flatkey.ai", "")}</small></SeoAnchor>
              {word.otherPages.length > 0 && <details className={closeout.otherPages}>
                <summary>其他有展示的页面（{word.otherPages.length}）</summary>
                <ul>{word.otherPages.map(page => <li key={page.url}>
                  <SeoAnchor href={page.url}>{page.url.replace("https://flatkey.ai", "")}</SeoAnchor>
                  <small>{page.impressions} 次展示 · {page.clicks} 次点击{page.position != null ? ` · GSC 平均 ${chartNumber(page.position)}` : ""}</small>
                </li>)}</ul>
              </details>}
            </th>
            <td>{word.country} · {word.language}</td>
            <td><strong className={word.rank === null ? closeout.pending : undefined}>{word.rank ?? "待实查"}</strong>
              {word.rank !== null && <span className={closeout.rankStatus} data-met={word.rank <= word.rankTarget}>{word.rank <= word.rankTarget ? "已达标" : "未达标"}</span>}
              <small className={closeout.metricGoal}>目标前 {word.rankTarget}</small>
              {word.metrics?.position != null && <small>GSC 平均 {chartNumber(word.metrics.position)}</small>}</td>
            <td><CloseoutMetric value={word.metrics?.impressions} target={word.goal.impressions} />
              {word.metrics ? <small>截至 {shortDay(word.metrics.end)}</small> : word.queryCheckedThrough ? <small>截至 {shortDay(word.queryCheckedThrough)} 无 GSC 记录</small> : null}
              {word.baseline && <small>基线 {chartNumber(word.baseline.impressions)}</small>}</td>
            <td><CloseoutMetric value={word.metrics?.clicks} target={word.goal.clicks} />
              {word.baseline && <small>基线 {chartNumber(word.baseline.clicks)}</small>}</td>
            <td><CloseoutMetric value={word.metrics?.ctr} target={word.goal.ctr} unit="%" /></td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className={closeout.context}>GSC 平均排名另行列示。基线区间为 {CLOSEOUT_CORE_BASELINE.start} 至 {CLOSEOUT_CORE_BASELINE.end}。</p>
    </section>
  </ChartPanel>;
}

const shortRange = (start: string, end: string) => `${shortDay(start)}–${shortDay(end)}`;

function CloseoutMetric({ value, target, unit = "" }: { value?: number | null; target: number | null; unit?: string }) {
  return <>
    <strong className={value == null ? closeout.pending : undefined}>{value == null ? "暂无数据" : chartNumber(value) + unit}</strong>
    <small className={closeout.metricGoal}>{target === null ? "目标待定" : "目标 " + chartNumber(target) + unit}</small>
  </>;
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

function KeywordReadError({ error, retry }: { error: string; retry: () => void }) {
  return <div className="loadError" role="alert"><span>{error}</span><button type="button" onClick={retry}>重新加载</button></div>;
}

export function OverviewKeywordProgress({ growth, ranking }: {
  growth: SeoReadState<OverviewKeywordSummary>;
  ranking: SeoReadState<OverviewKeywordSummary>;
}) {
  const ordinary = growth.data?.ordinary;
  const effective = ranking.data?.coverage;
  const value = ordinary?.due ? ordinary.covered / ordinary.due * 100 : null;
  return <ChartPanel title="关键词覆盖与排名">
    <div className={styles.keywordProgress}>
      <section aria-labelledby="overview-ordinary-keywords">
        <h3 id="overview-ordinary-keywords">普通关键词覆盖</h3>
        {ordinary ? <><p className={styles.note}>{`截至 ${ordinary.through} · 统计正式排期已到期的普通主词`}</p>
          <GoalPlot label="已由正式上线页覆盖" value={value} goal={ORDINARY_COVERAGE_GOAL} unit="%"
            empty="暂无到期主词" denominator={`${ordinary.covered} / ${ordinary.due} 个到期主词`} /></>
          : growth.error ? <KeywordReadError error={growth.error} retry={growth.retry} />
          : <p className={styles.note} role="status">{growth.loading ? "正在读取正式排期和上线回执…" : "覆盖证据待核。"}</p>}
      </section>
      <section aria-labelledby="overview-effective-keywords">
        <h3 id="overview-effective-keywords">当前有效关键词排名</h3>
        <p className={styles.note}>统计已确认的搜索结果前 100 名，同一原词只计一次。</p>
        {effective ? <>
          <BarPlot rows={[{ label: "前 100 关键词", value: effective.total }, { label: "其中前 50", value: effective.top50 }]} unit="个原词" showAxis={false} />
          <details className={styles.closeoutDetails}>
            <summary>查看市场和排名区间分布</summary>
            <div className={styles.two}>
              <section><h4>市场占比</h4><BarPlot rows={effective.markets.map(market => ({
                label: market.label, value: market.share === null ? null : market.share * 100,
                suffix: `${market.count} 个原词`,
              }))} unit="%" empty="暂无有效排名" /></section>
              <section><h4>排名区间</h4><BarPlot rows={effective.bands.map(band => ({
                label: band.label, value: band.share === null ? null : band.share * 100,
                suffix: `${band.count} 个原词`,
              }))} unit="%" empty="暂无有效排名" /></section>
            </div>
          </details>
          {ranking.data?.partial ? <p className={styles.note}>部分排名来源暂未读齐。</p> : null}
        </> : ranking.error ? <KeywordReadError error={ranking.error} retry={ranking.retry} />
          : <p className={styles.note} role="status">{ranking.loading ? "正在读取有效排名…" : "暂无可核验的近期排名。"}</p>}
      </section>
    </div>
  </ChartPanel>;
}
