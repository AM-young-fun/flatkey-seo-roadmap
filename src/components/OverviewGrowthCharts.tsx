"use client";
import { useState } from "react";
import type { GrowthReportSnapshot, GrowthStrategy } from "@/lib/growth-strategy";
import type { GrowthWorkspace } from "@/lib/growth-types";
import type { ConversionProjection } from "@/lib/seo-conversion";
import { useSeoRead } from "./useSeoAnalytics";
import { quarterTargetWorkspace } from "./growth-topic-view";
import { BarPlot, ChartPanel, EmptyPlot, GoalPlot, chartNumber } from "./OverviewCharts";
import styles from "./OverviewCharts.module.css";
import { SeoAnchor } from "@/components/SeoAnchor";


export function OverviewGoalCharts({ snapshot }: { snapshot: GrowthReportSnapshot }) {
  const g = snapshot.goals;
  return <ChartPanel title="2026 收官季目标进度" note={`截至 ${g.deadline} · 剩余 ${g.daysRemaining} 天；流量 ${g.trafficPeriod.start}—${g.trafficPeriod.end}（洛杉矶）；排名核验时点 ${g.latestRankAt ?? "尚无有效采样"}`}>
    <div className={styles.grid}>
      <GoalPlot label="Flatkey 每周自然搜索会话" value={g.trafficScope ? g.weeklySessions : null} goal={3000} unit="次" denominator="Flatkey官网＋控制台生产域名，排除测试域名和IP" note={g.trafficComplete && g.trafficScope ? `完整七天；距目标 ${chartNumber(g.trafficGap)} 次` : "同窗口来源未齐或属于历史统计范围，暂不计算完成率"} />
      <GoalPlot label="季度关键词前100覆盖" value={g.baselineCount !== null && g.coverage !== null ? g.coverage * 100 : null} goal={60} unit="%" denominator={`R / N = ${chartNumber(g.rankedCount)} / ${chartNumber(g.baselineCount)} 个原词；固定季度目标1600`} note={g.baselineCount === null ? "季度清单尚未核定，未用词库总量代替N" : `未核验词留在N、不计R；距离目标 ${chartNumber(g.coverageGap)} 词`} />
      <GoalPlot label="已获排名关键词中前50" value={g.quality === null ? null : g.quality * 100} goal={80} unit="%" denominator={`F / R = ${chartNumber(g.top50Count)} / ${chartNumber(g.rankedCount)} 个有效前100原词`} note="仅使用原词语种与真实查询国家匹配的14天内完整SERP" />
    </div>
  </ChartPanel>;
}
function ContentProgress({ workspace }: { workspace: GrowthWorkspace | null }) {
  const rows = workspace ? quarterTargetWorkspace(workspace).targets : [];
  const states = [["completed", "已完成"], ["in_progress", "进行中"], ["planned", "已规划"], ["unknown", "进度待核"]] as const;
  return <ChartPanel title="季度内容建设进度" note={`单位：原词；分母为当前可读取的季度成员 ${workspace ? rows.length : "—"}，不是页面数或任务数；${workspace?.generatedAt ?? "来源待读取"}`}>
    <BarPlot rows={workspace && rows.length ? states.map(([state, label]) => ({ label, value: rows.filter(row => row.workState === state).length, color: state === "completed" ? "#32aa8b" : state === "unknown" ? "#b1bdcd" : undefined })) : []} unit="词" denominator="已完成、进行中、规划中及待核互斥计数" empty="季度成员或进度来源尚未齐全，暂不绘制" />
    <SeoAnchor className={styles.link} href="/opportunities">查看话题与关键词进度 →</SeoAnchor>
  </ChartPanel>;
}
function TopicComparison({ snapshot, workspace }: { snapshot: GrowthReportSnapshot | null; workspace: GrowthWorkspace | null }) {
  const [groupBy, setGroupBy] = useState<"topic" | "module">("topic");
  const [metric, setMetric] = useState<"sessions" | "clicks" | "impressions">("sessions");
  const labels = { sessions: "自然搜索会话", clicks: "Google点击", impressions: "Google曝光" };
  const drivers = [...new Map((snapshot?.directions.flatMap(direction => direction.drivers) ?? []).filter(row => row.metric === metric && row.window && row.window.start === snapshot?.period.start && row.window.end === snapshot?.period.end).map(row => [`${row.url}:${row.country}:${row.language}:${JSON.stringify(row.window)}:${row.source}`, row])).values()];
  const groups = new Map<string, { label: string; current: number; previous: number; href: string }>();
  for (const row of drivers) {
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
    <BarPlot rows={rows.map(row => ({ label: row.label, value: row.current - row.previous, href: row.href, suffix: `${chartNumber(row.previous)} → ${chartNumber(row.current)}` }))} signed unit={metric === "sessions" ? "次会话增减" : metric === "clicks" ? "次点击增减" : "次曝光增减"} denominator="页面贡献合计；同国家语言、同来源、同可比周期，切片不叠加为全站总量" empty="尚无同口径的话题或页面涨跌证据，未把产量当作流量贡献" />
  </ChartPanel>;
}
export function ConversionCharts({ projection }: { projection: ConversionProjection | null }) {
  const registration = projection?.api.registration, payment = projection?.api.firstPayment30d;
  const cohorts = payment?.cohorts ?? [];
  const readyRate = (value: { value: number | null; status: string } | undefined) => value?.status === "ready" && value.value !== null ? value.value * 100 : null;
  return <div className={styles.two}>
    <ChartPanel title="API 自然获客注册与30天首次付费" note={`单位：独立用户 / %；${projection ? `${projection.scope.start}—${projection.scope.end}（洛杉矶）` : "注册批次待读取"}；会话趋势另列，不与用户混画漏斗`}>
      <h3 className={styles.subheading}>自然获客注册率</h3><BarPlot rows={[{ label: "合资格首注 / 访客", value: readyRate(registration?.rate), suffix: `${chartNumber(registration?.eligibleFirstRegistrations?.value)} / ${chartNumber(registration?.eligibleVisitors.value)} 人` }]} unit="%" denominator="同批合资格自然访客，排除已注册回访用户" empty={registration?.rate.reason ?? "首注用户及同批合资格访客来源待关联，暂不计算注册率"} />
      <div className={styles.sectionSpace}><BarPlot rows={cohorts.map(row => ({ label: `${row.registrationStart}—${row.registrationEnd}`, value: row.maturity === "mature" && row.status === "ready" && row.rate !== null ? row.rate * 100 : null, suffix: row.maturity === "mature" ? `${chartNumber(row.confirmedFirstPayers)} / ${chartNumber(row.matureRegisteredUsers)} 人` : "观察窗口未满 / 来源待齐" }))} unit="%" denominator="每批注册后30天首次付费人数 / 同批成熟注册人数" empty={payment?.rate.reason ?? "尚无可关联且已满30天的注册批次，未成熟或缺源保持未知"} /></div>
      {cohorts.some(row => row.maturity !== "mature" || row.status !== "ready") ? <p className={styles.note}>未成熟、混合窗口或缺源批次不绘制付费率为0；真实0仅在完整成熟证据成立时展示。</p> : null}
    </ChartPanel>
    <ChartPanel title="GPU 租赁业务承接" note={`单位：询盘 / 报价 / 成交；${projection ? `${projection.scope.start}—${projection.scope.end}（洛杉矶）` : "业务来源待关联"}；各环节独立展示，不虚构跨系统漏斗`}>
      <BarPlot rows={projection ? [["询盘", projection.gpu.inquiries], ["报价", projection.gpu.quotes], ["成交", projection.gpu.deals]].map(([label, raw]) => { const metric = raw as ConversionProjection["gpu"]["inquiries"]; return { label: label as string, value: metric.status === "ready" ? metric.value : null }; }) : []} unit="件" denominator="仅有可靠来源与自然获客关联的业务记录" empty="尚无可靠询盘、报价、成交来源，未假定为0" />
      <p className={styles.note}>GPU采购周期另做持续观察；不能因30天注册首付指标不足单独否定GPU方向。{projection?.readiness.reasons.join("；")}</p>
    </ChartPanel>
  </div>;
}
export function OverviewGrowthCharts() {
  const strategy = useSeoRead<{ snapshot: GrowthReportSnapshot; state: GrowthStrategy }>("/api/seo/growth/strategy");
  const growth = useSeoRead<GrowthWorkspace>("/api/seo/growth");
  const conversion = useSeoRead<ConversionProjection>("/api/seo/growth/conversion");
  return <>
    {strategy.data?.snapshot ? <OverviewGoalCharts snapshot={strategy.data.snapshot} /> : <ChartPanel title="2026 收官季目标进度" note="Flatkey每周3000自然搜索会话；季度1600词，前100覆盖60%，其中前50占80%"><EmptyPlot reason={strategy.error ?? "正在读取已冻结目标与同窗口来源"} /></ChartPanel>}
    <div className={styles.two}><ContentProgress workspace={growth.data} /><TopicComparison snapshot={strategy.data?.snapshot ?? null} workspace={growth.data} /></div>
    <ConversionCharts projection={conversion.data} />
  </>;
}
