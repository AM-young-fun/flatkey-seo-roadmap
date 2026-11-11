"use client";

import { useState } from "react";
import { CLUSTER_SITES, type ClusterDomain } from "@/lib/seo-cluster-sites";
import type { DateRange } from "@/lib/seo-date-range";
import { analyticsUrl, numberText, useSeoRead } from "./useSeoAnalytics";
import { useSeoCountry } from "./useSeoCountry";
import styles from "./SeoPageCatalog.module.css";
import measurement from "./BusinessMeasurementStatus.module.css";

type ClusterDay = {
  date: string;
  sessions: number | null;
  registrations: number | null;
  clicks: number | null;
  impressions: number | null;
  searchFinal: boolean;
};

const metrics = [
  ["sessions", "自然搜索访问"], ["registrations", "注册人次"],
  ["clicks", "Google 搜索点击"], ["impressions", "Google 搜索曝光"],
] as const;

function SiteRow({ site, url }: {
  site: { domain: ClusterDomain; name: string; ga4: string | null; gsc: string | null };
  url: string;
}) {
  const report = useSeoRead<{ daily: ClusterDay[] }>(site.ga4 || site.gsc ? url : null);
  const [expanded, setExpanded] = useState(false);
  const days = report.data?.daily ?? [];
  const recorded = days.filter(day => metrics.some(([key]) => day[key] !== null));
  return <>
    <tr>
      <th scope="row">
        {days.length > 1 && recorded.length > 0
          ? <button type="button" className={styles.pageLink} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{site.name}</button>
          : site.name}
        <small>{site.domain}</small>
        <a className={styles.siteAction} href={"/pages?" + new URLSearchParams({ ...Object.fromEntries(new URL(url, "https://workspace.invalid").searchParams), site: site.domain })}>选择该站页面 →</a>
        {report.error ? <button type="button" onClick={report.retry}>重试</button>
          : !site.ga4 && !site.gsc ? <small>待开通报表权限</small>
          : !report.data ? <small>读取中</small>
          : !recorded.length ? <small>所选日期暂无数据</small> : null}
      </th>
      {metrics.map(([key, label]) => {
        const values = days.flatMap(day => day[key] === null ? [] : [day[key]]);
        const searchMetric = key === "clicks" || key === "impressions";
        return <td key={key} data-label={label}>
          {numberText(values.length ? values.reduce((sum, value) => sum + value, 0) : null)}
          {values.length > 0 && (values.length < days.length || searchMetric && days.some(day => day[key] !== null && !day.searchFinal))
            ? <small>{values.length < days.length ? `${values.length}/${days.length} 天` : "部分数据"}</small> : null}
        </td>;
      })}
    </tr>
    {expanded && days.length > 1 && recorded.length > 0 ? <tr><td colSpan={5}>
      <div className={styles.scroll}>
        <table className={styles.daily} aria-label={`${site.name} 每日数据`}>
          <thead><tr><th>日期</th>{metrics.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead>
          <tbody>{[...recorded].reverse().map(day => <tr key={day.date}>
            <th scope="row">{day.date}</th>{metrics.map(([key]) => <td key={key}>{numberText(day[key])}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
    </td></tr> : null}
  </>;
}

export function SeoClusterReport({ range }: { range: DateRange }) {
  return <section aria-label="集群选站参考">
    <p className={styles.note}>先选择站点，再进入具体页面创建优化任务。</p>
    <ClusterSiteTable range={range} />
    <aside className={measurement.panel} aria-label="集群业务贡献接入状态">
      <div><strong>集群业务贡献待接入</strong><a href="/issues">查看集群待处理事项 →</a></div>
      <dl><div><dt>站内功能使用</dt><dd>待接入</dd></div><div><dt>前往 Flatkey 的访问</dt><dd>待接入</dd></div><div><dt>引流后的激活与付费</dt><dd>待接入</dd></div></dl>
      <p>上表为各站自身的自然搜索数据。集群引流贡献需单独核验来源页面、按钮和后续事件；各站注册事件未核实前保持缺失，不合并为 Flatkey 注册。</p>
    </aside>
  </section>;
}

export function ClusterSiteTable({ range, domain, label = "集群网站自然搜索效果" }: {
  range: DateRange;
  domain?: ClusterDomain;
  label?: string;
}) {
  const [country] = useSeoCountry();
  const sites = domain ? CLUSTER_SITES.filter(site => site.domain === domain) : CLUSTER_SITES;
  return <div className={styles.scroll}>
      <table className={styles.table} aria-label={label}>
        <thead><tr><th scope="col">网站</th>{metrics.map(([key, label]) => <th key={key} scope="col">{label}</th>)}</tr></thead>
        <tbody>{sites.map(site => <SiteRow key={site.domain} site={site} url={analyticsUrl(range, [], country) + "&site=" + site.domain} />)}</tbody>
      </table>
    </div>;
}
