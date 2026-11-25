"use client";
import { useState } from "react";
import type { GrowthReportSnapshot } from "@/lib/growth-strategy";
import type { GrowthWorkspace } from "@/lib/growth-types";
import type { ConversionProjection } from "@/lib/seo-conversion";
import type { SeoReadState } from "./useSeoAnalytics";
import { quarterTargetWorkspace } from "./growth-topic-view";
import { BarPlot, ChartPanel, GoalPlot, chartNumber } from "./OverviewCharts";
import styles from "./OverviewCharts.module.css";
import { SeoAnchor } from "@/components/SeoAnchor";
import { growthComparisonGroups, growthContributionDrivers } from "@/lib/growth-topic-contributions";
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

const moduleNames = new Map([["home", "首页"], ["blog", "博客"], ["models", "模型"], ["gpu", "GPU"], ["prompts", "Prompt"], ["other", "其他功能页"]]);
const languageNames = new Intl.DisplayNames("zh-CN", { type: "language" });
const countryNames = new Intl.DisplayNames("zh-CN", { type: "region" });
const languageLabel = (value: string) => {
  if (value === "und") return "语言待核";
  try { return languageNames.of(value) ?? value; } catch { return value; }
};

function ContributionPage({ page }: { page: { url: string; title: string } }) {
  const url = new URL(page.url), path = `${url.pathname}${url.search}${url.hash}`;
  return <SeoAnchor href={page.url} title={page.url}>{page.title?.startsWith("页面 /") ? path : <>{page.title || path}{page.title && page.title !== path ? <small>{path}</small> : null}</>}</SeoAnchor>;
}

export function TopicComparison({ snapshot, workspace }: { snapshot: GrowthReportSnapshot | null; workspace: GrowthWorkspace | null }) {
  const [groupBy, setGroupBy] = useState<"topic" | "module">("topic");
  const [selectedMetric, setMetric] = useState<"sessions" | "clicks" | "impressions" | null>(null);
  const available = (["sessions", "clicks", "impressions"] as const).find(metric =>
    growthContributionDrivers(snapshot, metric).some(row => groupBy === "module" || row.topicId));
  const metric = selectedMetric ?? available ?? "sessions";
  const labels = { sessions: "自然搜索会话", clicks: "Google点击", impressions: "Google曝光" };
  const mainRows = growthComparisonGroups(snapshot, metric, groupBy).slice(0, 10);
  const rows = mainRows.map(row => {
    const topicName = workspace?.topics.find(topic => topic.site === row.site && topic.topicId === row.topicId)?.name;
    const site = workspace?.sites.find(item => item.domain === row.site)?.name ?? row.site;
    const country = row.country.toUpperCase();
    const countryName = country === "ALL" ? "全部国家" : /^[A-Z]{2}$/.test(country) ? countryNames.of(country) ?? row.country : row.country;
    const comparisons = mainRows.some(other => row !== other && other.site === row.site && other.country === row.country && other.language === row.language
      && (groupBy === "module" ? other.module === row.module : other.topicId === row.topicId));
    const context = [site, countryName, languageLabel(row.language), ...(comparisons ? [`对比 ${shortDay(row.window.previousStart)}—${shortDay(row.window.previousEnd)}`] : [])].join(" · ");
    const firstPage = row.pages[0];
    const fallbackTopicName = firstPage.title || new URL(firstPage.url).pathname;
    const label = groupBy === "module" ? moduleNames.get(row.module) ?? (row.module || "模块待核")
      : topicName ?? `${fallbackTopicName}${row.pages.length > 1 ? ` 等 ${row.pages.length} 页` : ""}`;
    const details = row.pages.length === 1 ? <ContributionPage page={firstPage} /> : <details>
      <summary>{row.pages.length} 个贡献页面</summary>
      <ul>{row.pages.map(page => <li key={page.url}><ContributionPage page={page} /><small>{chartNumber(page.previous)} → {chartNumber(page.current)}</small></li>)}</ul>
    </details>;
    return { id: row.id, label, context, details, value: row.current - row.previous, suffix: `${chartNumber(row.previous)} → ${chartNumber(row.current)}` };
  });
  return <ChartPanel title="话题与内容涨跌贡献对比">
    <div className={styles.switcher} aria-label="归因分组"><button type="button" aria-pressed={groupBy === "topic"} onClick={() => setGroupBy("topic")}>按话题</button><button type="button" aria-pressed={groupBy === "module"} onClick={() => setGroupBy("module")}>按模块</button></div>
    <div className={styles.switcher} aria-label="话题比较指标">{Object.entries(labels).map(([key, label]) => <button key={key} type="button" aria-pressed={metric === key} onClick={() => setMetric(key as typeof metric)}>{label}</button>)}</div>
    {rows.length ? <BarPlot rows={rows} signed unit={metric === "sessions" ? "次会话增减" : metric === "clicks" ? "次点击增减" : "次曝光增减"} denominator="页面贡献合计；同国家语言、同来源、同可比周期，切片不叠加为全站总量" />
      : <p className={styles.note}>尚无同口径的{groupBy === "topic" ? "话题" : "模块"}{labels[metric]}涨跌证据。</p>}
  </ChartPanel>;
}
export type OverviewConversion = ConversionProjection & { ga4OrganicRegistrants?: { users: number; observedAt: string } | null };

export function ConversionCharts({ projection }: { projection: OverviewConversion | null }) {
  const registration = projection?.api.registration, payment = projection?.api.firstPayment30d;
  const cohorts = payment?.cohorts ?? [];
  const readyRate = (value: { value: number | null; status: string } | undefined) => value?.status === "ready" && value.value !== null ? value.value * 100 : null;
  const registrationRate = readyRate(registration?.rate);
  const gpuRows = projection ? [[ "询盘", projection.gpu.inquiries ], [ "报价", projection.gpu.quotes ], [ "成交", projection.gpu.deals ]].map(([label, raw]) => {
    const metric = raw as ConversionProjection["gpu"]["inquiries"];
    return { label: label as string, value: metric.status === "ready" ? metric.value : null };
  }) : [];
  return <div className={styles.two}>
    <ChartPanel title="API 自然获客注册与30天首次付费">
      <h3 className={styles.subheading}>自然获客注册率</h3>
      {registrationRate === null ? <p className={styles.note}>待接入可核验的首次账户身份及合资格访客。</p>
        : <BarPlot rows={[{ label: "合资格首注 / 访客", value: registrationRate, suffix: `${chartNumber(registration?.eligibleFirstRegistrations?.value)} / ${chartNumber(registration?.eligibleVisitors.value)} 人` }]} unit="%" denominator="同批合资格自然访客，排除已注册回访用户" />}
      <div className={styles.sectionSpace}><h3 className={styles.subheading}>30 天首次付费率</h3>
        {cohorts.some(row => row.maturity === "mature" && row.status === "ready" && row.rate !== null)
          ? <BarPlot rows={cohorts.map(row => ({ label: `${row.registrationStart}—${row.registrationEnd}`, value: row.maturity === "mature" && row.status === "ready" && row.rate !== null ? row.rate * 100 : null, suffix: row.maturity === "mature" ? `${chartNumber(row.confirmedFirstPayers)} / ${chartNumber(row.matureRegisteredUsers)} 人` : "观察窗口未满 / 来源待齐" }))} unit="%" denominator="每批注册后30天首次付费人数 / 同批成熟注册人数" />
          : <p className={styles.note}>未成熟批次或缺完整的首付记录，暂不可计算。</p>}
      </div>
      {cohorts.some(row => row.maturity !== "mature" || row.status !== "ready") ? <p className={styles.note}>未成熟、混合窗口或缺源批次不绘制付费率为0；真实0仅在完整成熟证据成立时展示。</p> : null}
    </ChartPanel>
    <ChartPanel title="GPU 租赁业务承接">
      {gpuRows.some(row => row.value !== null) ? <BarPlot rows={gpuRows} unit="件" denominator="仅有可靠来源与自然获客关联的业务记录" />
        : <p className={styles.note}>尚无可靠的自然搜索询盘、报价或成交来源。</p>}
    </ChartPanel>
  </div>;
}
export function OverviewReadFailure({ title, error, retry }: { title: string; error: string; retry: () => void }) {
  return <ChartPanel title={title} note="">
    <div className="loadError" role="alert"><span>{error}</span><button type="button" onClick={retry}>重新加载</button></div>
  </ChartPanel>;
}

export function OverviewGrowthCharts({ strategy, growth, conversion }: {
  strategy: SeoReadState<{ snapshot: GrowthReportSnapshot }>;
  growth: SeoReadState<GrowthWorkspace>;
  conversion: SeoReadState<OverviewConversion>;
}) {
  return <>
    {strategy.data?.snapshot ? <OverviewGoalCharts snapshot={strategy.data.snapshot} />
      : strategy.loading ? <ChartPanel title="2026 收官季目标进度" note=""><p role="status">正在重读季度目标…</p></ChartPanel>
      : <OverviewReadFailure title="2026 收官季目标进度" error={strategy.error ?? "季度目标未返回，请重试"} retry={strategy.retry} />}
    <div className={styles.two}>
      {growth.data ? <ContentProgress workspace={growth.data} />
        : growth.loading ? <ChartPanel title="季度内容建设进度" note=""><p role="status">正在重读建设进度…</p></ChartPanel>
        : <OverviewReadFailure title="季度内容建设进度" error={growth.error ?? "建设进度未返回，请重试"} retry={growth.retry} />}
      {strategy.data?.snapshot ? <TopicComparison snapshot={strategy.data.snapshot} workspace={growth.data} />
        : <ChartPanel title="话题与内容涨跌贡献对比" note=""><p>{strategy.loading ? "正在重读对比数据…" : "请重新加载季度目标，以读取同期贡献数据。"}</p></ChartPanel>}
    </div>
    {conversion.data ? <ConversionCharts projection={conversion.data} />
      : conversion.loading ? <ChartPanel title="API 与 GPU 业务承接" note=""><p role="status">正在重读业务数据…</p></ChartPanel>
      : <OverviewReadFailure title="API 与 GPU 业务承接" error={conversion.error ?? "业务数据未返回，请重试"} retry={conversion.retry} />}
  </>;
}
