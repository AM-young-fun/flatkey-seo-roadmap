"use client";

import { useEffect, useState } from "react";
import { clientReadCache } from "@/lib/client-read-cache";
import type { DailySeoTrafficHistory } from "@/lib/daily-seo-traffic";
import type { DateRange } from "@/lib/seo-date-range";
import { dailyMetrics } from "@/lib/seo-report";

export function SeoPeriodSummary({ range, comparison }: { range: DateRange; comparison: DateRange | null }) {
  const [data, setData] = useState<{ current: DailySeoTrafficHistory; previous: DailySeoTrafficHistory | null } | null>(null);
  const [error, setError] = useState("");
  const comparisonStart = comparison?.start, comparisonEnd = comparison?.end;
  useEffect(() => {
    let active = true;
    setData(null); setError("");
    const read = (range: DateRange) => clientReadCache.read<DailySeoTrafficHistory>("/api/traffic/daily?site=flatkey.ai&" + new URLSearchParams(range));
    Promise.all([read(range), comparisonStart && comparisonEnd ? read({ start: comparisonStart, end: comparisonEnd }) : null])
      .then(([current, previous]) => { if (active) setData({ current, previous }); })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [range, comparisonStart, comparisonEnd]);
  if (error) return <p role="alert" className="seoNotice">区间摘要读取失败：{error}</p>;
  if (!data) return <p className="chartNote">正在核对区间变化…</p>;
  const metrics = dailyMetrics(data.current), prior = data.previous ? dailyMetrics(data.previous) : null;
  const delta = (now: number | null, before: number | null | undefined) => {
    if (!comparison) return "未选择对比区间";
    if (now === null || before == null) return "存在缺日，暂不计算变化";
    if (before === 0) return `对比期为0；绝对变化 ${(now - before).toFixed(1)}`;
    const percent = (now - before) / before * 100;
    return `较对比期 ${percent > 0 ? "+" : ""}${percent.toFixed(1)}%`;
  };
  const latest = data.current.points.at(-1);
  return <section aria-label="区间变化摘要">
    <div className="seoMetricGrid">
      <article><h2>日均自然搜索新用户</h2><strong>{metrics.newUsersAverage?.toFixed(1) ?? "待补齐"}</strong><p>{delta(metrics.newUsersAverage, prior?.newUsersAverage)}</p></article>
      <article><h2>日均注册用户</h2><strong>{metrics.registrationsAverage?.toFixed(1) ?? "待补齐"}</strong><p>{delta(metrics.registrationsAverage, prior?.registrationsAverage)}</p></article>
      <article><h2>完整日记录</h2><strong>{data.current.coverage.completeDays}<small> / {data.current.coverage.days} 天</small></strong><p>{data.current.coverage.completeDays === data.current.coverage.days ? "所选日期两项均已采集" : "缺失保留为空，等待补采"}</p></article>
      <article><h2>截止日 · {range.end}</h2><strong>{latest?.newUsers ?? "—"}<small> 新用户</small></strong><p>当天注册 {latest?.newRegistrations ?? "待补采"} 人</p></article>
    </div>
    <p className="chartNote">首次自然搜索获客口径。日均按完整日期序列计算；日均注册不是区间去重注册，不能据此计算新访客注册转化率。</p>
  </section>;
}
