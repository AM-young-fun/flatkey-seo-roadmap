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
import { growthContributionDrivers } from "@/lib/growth-topic-contributions";
import { dailyTrafficComparisonText } from "@/lib/growth-goal-display";


export function OverviewGoalCharts({ snapshot }: { snapshot: GrowthReportSnapshot }) {
  const g = snapshot.goals;
  return <ChartPanel title="2026 收官季目标进度" note={`截至 ${g.deadline} · 剩余 ${g.daysRemaining} 天；流量 ${g.trafficPeriod.start}—${g.trafficPeriod.end}（洛杉矶）；排名核验时点 ${g.latestRankAt ?? "尚无有效采样"}`}>
    <div className={styles.grid}>
      <GoalPlot label={g.trafficWindowKind === "rolling7day-v1" ? "Flatkey 日常最新滚动7日自然搜索会话" : "Flatkey 每周自然搜索会话"} value={g.trafficScope ? g.weeklySessions : null} goal={3000} unit="次" denominator="Flatkey官网＋控制台生产域名，排除测试域名和IP" note={(g.trafficComplete && g.trafficScope ? `完整七天；距目标 ${chartNumber(g.trafficGap)} 次` : "同窗口来源未齐或属于历史统计范围，暂不计算完成率") + (g.dailyTrafficObservation ? `；${dailyTrafficComparisonText(g)}` : "")} />
      <GoalPlot label="季度关键词前100覆盖" value={g.baselineCount !== null && g.coverage !== null ? g.coverage * 100 : null} goal={60} unit="%" denominator={`R / N = ${chartNumber(g.rankedCount)} / ${chartNumber(g.baselineCount)} 个原词；固定季度目标1600`} note={g.baselineCount === null ? "季度清单尚未核定，未用词库总量代替N" : `未核验词留在N、不计R；距离目标 ${chartNumber(g.coverageGap)} 词`} />
      <GoalPlot label="已获排名关键词中前50" value={g.quality === null ? null : g.quality * 100} goal={80} unit="%" denominator={`F / R = ${chartNumber(g.top50Count)} / ${chartNumber(g.rankedCount)} 个有效前100原词`} note="仅使用原词语种与真实查询国家匹配的14天内完整SERP" />
    </div>
  </ChartPanel>;
}
function ContentProgress({ workspace }: { workspace: GrowthWorkspace | null }) {
  const rows = workspace ? quarterTargetWorkspace(workspace).targets : [];
  const states = [["completed", "已有公开页"], ["in_progress", "制作中"], ["scheduled", "已排期"], ["researching", "研究中"], ["planned", "已规划"], ["unknown", "进度待核"]] as const;
  return <ChartPanel title="季度内容建设进度" note={`单位：原词；分母为当前可读取的季度成员 ${workspace?.quarter ? rows.length : "尚未核定"}，不是页面数或任务数；${workspace?.generatedAt ?? "来源待读取"}`}>
    <BarPlot rows={workspace && rows.length ? states.map(([state, label]) => ({ label, value: rows.filter(row => row.workState === state).length, color: state === "completed" ? "#32aa8b" : state === "unknown" ? "#b1bdcd" : undefined })) : []} unit="词" denominator="建设阶段互斥；已排期须有正式计划，制作中依据原制作状态；已有公开页不代表维护任务全部完成" empty="季度成员或进度来源尚未齐全，暂不绘制" />
    <SeoAnchor className={styles.link} href="/opportunities">查看话题与关键词进度 →</SeoAnchor>
  </ChartPanel>;
}
export function TopicComparison({ snapshot, workspace }: { snapshot: GrowthReportSnapshot | null; workspace: GrowthWorkspace | null }) {
  const [groupBy, setGroupBy] = useState<"topic" | "module">("topic");
  const [selectedMetric, setMetric] = useState<"sessions" | "clicks" | "impressions" | null>(null);
  const available = (["sessions", "clicks", "impressions"] as const).find(metric =>
    growthContributionDrivers(snapshot, metric).some(row => groupBy === "module" || row.topicId));
  const metric = selectedMetric ?? available ?? "sessions";
  const labels = { sessions: "自然搜索会话", clicks: "Google点击", impressions: "Google曝光" };
  const drivers = growthContributionDrivers(snapshot, metric);
  const groups = new Map<string, { label: string; current: number; previous: number; href: string }>();
  for (const row of drivers) {
    if (groupBy === "topic" && !row.topicId) continue;
    const site = new URL(row.url).hostname.replace(/^www\./, "");
    const key = `${site}:${groupBy === "topic" ? row.topicId ?? row.url : row.module}:${row.country}:${row.language}`;
    const topicName = workspace?.topics.find(topic => topic.site === site && topic.topicId === row.topicId)?.name;
    const label = `${groupBy === "topic" ? topicName ?? row.title : row.module || "模块待核"} · ${row.country}`;
    // Never aggregate different windows or source dimensions into a fabricated topic total.
    const groupKey = `${key}:${JSON.stringify(row.window)}:${row.source}`;
    const old = groups.get(groupKey);
    groups.set(groupKey, { label, current: (old?.current ?? 0) + row.current, previous: (old?.previous ?? 0) + row.previous, href: row.url });
  }
  const rows = [...groups.values()].sort((a, b) => Math.abs(b.current - b.previous) - Math.abs(a.current - a.previous)).slice(0, 10);
  return <ChartPanel title="话题与内容涨跌贡献对比" note={`指标与来源分开显示；${snapshot ? `${snapshot.period.start}—${snapshot.period.end}（${snapshot.period.timezone}）` : "可比周期待读取"}；仅已保存的可比页面证据，非全站分摊`}>
    <div className={styles.switcher} aria-label="归因分组"><button type="button" aria-pressed={groupBy === "topic"} onClick={() => setGroupBy("topic")}>按话题</button><button type="button" aria-pressed={groupBy === "module"} onClick={() => setGroupBy("module")}>按模块</button></div>
    <div className={styles.switcher} aria-label="话题比较指标">{Object.entries(labels).map(([key, label]) => <button key={key} type="button" aria-pressed={metric === key} onClick={() => setMetric(key as typeof metric)}>{label}</button>)}</div>
    {rows.length ? <BarPlot rows={rows.map(row => ({ label: row.label, value: row.current - row.previous, href: row.href, suffix: `${chartNumber(row.previous)} → ${chartNumber(row.current)}` }))} signed unit={metric === "sessions" ? "次会话增减" : metric === "clicks" ? "次点击增减" : "次曝光增减"} denominator="页面贡献合计；同国家语言、同来源、同可比周期，切片不叠加为全站总量" />
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
    <ChartPanel title="API 自然获客注册与30天首次付费" note={`单位：独立用户 / %；${projection ? `${projection.scope.start}—${projection.scope.end}（洛杉矶）` : "注册批次待读取"}；会话趋势另列，不与用户混画漏斗`}>
      {projection?.ga4OrganicRegistrants ? <p className={styles.note}>Flatkey 全站 GA4 自然获客注册 <strong>{chartNumber(projection.ga4OrganicRegistrants.users)} 人</strong> · 区间去重</p> : null}
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
    <ChartPanel title="GPU 租赁业务承接" note={`单位：询盘 / 报价 / 成交；${projection ? `${projection.scope.start}—${projection.scope.end}（洛杉矶）` : "业务来源待关联"}；各环节独立展示，不虚构跨系统漏斗`}>
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
