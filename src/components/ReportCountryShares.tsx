"use client";

import { useState, type CSSProperties } from "react";
import { REPORT_MARKETS, reportCountryShares, type ReportComparisonGroups } from "@/lib/seo-report-comparisons";
import { numberText } from "./useSeoAnalytics";
import styles from "./SeoDigestReports.module.css";

const metrics = [["自然会话", "自然搜索访问"], ["Google 点击", "Google 点击"], ["曝光", "Google 曝光"]] as const;

function sharePath(start: number, share: number) {
  const point = (fraction: number) => {
    const angle = (fraction * 2 - 0.5) * Math.PI;
    return [50 + 48 * Math.cos(angle), 50 + 48 * Math.sin(angle)].join(" ");
  };
  return `M 50 50 L ${point(start)} A 48 48 0 ${share > .5 ? 1 : 0} 1 ${point(start + share)} Z`;
}

function MetricShare({ groups, metric, label }: { groups: ReportComparisonGroups; metric: string; label: string }) {
  const [active, setActive] = useState<string | null>(null);
  const rows = reportCountryShares(groups, metric);
  const hovered = rows?.find(row => row.code === active);
  let start = 0;
  return <div className={styles.countryMetric}>
    <h4>{label}</h4>
    {rows ? <div className={styles.countryPlot}>
      <svg viewBox="0 0 100 100" role="group" aria-label={`${label}的四国份额`}>
        {rows.map(row => {
          const current = start;
          start += row.share;
          if (row.share === 0) return null;
          const handlers = {
            tabIndex: 0,
            "aria-label": `${row.label} ${numberText(row.value)}，占 ${(row.share * 100).toFixed(1)}%`,
            onMouseEnter: () => setActive(row.code), onMouseLeave: () => setActive(null),
            onFocus: () => setActive(row.code), onBlur: () => setActive(null),
            fill: row.color,
          };
          return row.share === 1 ? <circle key={row.code} cx="50" cy="50" r="48" {...handlers} />
            : <path key={row.code} d={sharePath(current, row.share)} {...handlers} />;
        })}
      </svg>
      {hovered ? <span role="tooltip" className={styles.countryTooltip}>{hovered.label} · {numberText(hovered.value)} · {(hovered.share * 100).toFixed(1)}%</span> : null}
    </div> : <p className={styles.countryMissing}>四国同日数据待齐，或合计为 0。</p>}
  </div>;
}

export function ReportCountryShares({ groups }: { groups: ReportComparisonGroups }) {
  return <section className={styles.countrySection} aria-label="Flatkey 四国占比">
    <h4>Flatkey 四国占比 <small>以四国本期合计为分母</small></h4>
    <div className={styles.countryCharts}>{metrics.map(([metric, label]) => <MetricShare key={metric} {...{ groups, metric, label }} />)}</div>
    <ul className={styles.countryLegend}>
      {REPORT_MARKETS.map(({ label, color }) => <li key={label} style={{ "--market-color": color } as CSSProperties}>{label}</li>)}
    </ul>
  </section>;
}
