"use client";

import { useState } from "react";
import { TRAFFIC_SUMMARY_MODULES, TRAFFIC_SUMMARY_SITE_METRICS, type TrafficSummaryRead } from "@/lib/seo-traffic-summary";
import { ChartPanel } from "./OverviewCharts";
import { useSeoRead } from "./useSeoAnalytics";
import styles from "./TrafficRegistrationSummary.module.css";

const labels = {
  totalSessions: "总会话",
  organicSessions: "自然搜索会话",
  totalRegistrations: "总注册",
  organicRegistrations: "自然搜索注册",
};
const number = (value?: number | null) => value == null ? "—" : value.toLocaleString("zh-CN");
const delta = (current?: number, previous?: number) => current === undefined || previous === undefined
  ? "缺可比数据"
  : `较前一日 ${current > previous ? "+" : ""}${number(current - previous)}`;

export function TrafficRegistrationSummary() {
  const [date, setDate] = useState("");
  const endpoint = "/api/seo/traffic-summary" + (date ? "?date=" + encodeURIComponent(date) : "");
  const read = useSeoRead<TrafficSummaryRead>(endpoint, { showFeedback: false });
  const data = read.data, day = data?.day, previous = data?.previous;
  return <ChartPanel title="Flatkey 流量与注册">
    <div className={styles.controls}>
      <label>洛杉矶统计日 <input type="date" value={date || data?.date || ""} max={data?.latestClosedDay}
        onChange={event => setDate(event.target.value)} /></label>
      {date && <button type="button" onClick={() => setDate("")}>最近统计日</button>}
    </div>
    {read.loading && !data ? <p role="status">正在读取数据…</p> : null}
    {read.error ? <div className="loadError" role="alert"><span>{read.error}</span><button type="button" onClick={read.retry}>重新加载</button></div> : null}
    {data ? <>
      <dl className={styles.cards}>
        {TRAFFIC_SUMMARY_SITE_METRICS.map(key => <div key={key}>
          <dt>{labels[key]}</dt>
          <dd>{number(day?.site[key]?.value)}{day?.site[key] ? <small>{key.endsWith("Sessions") ? " 次" : " 人"}</small> : null}</dd>
          <dd className={styles.comparison}>{delta(day?.site[key]?.value, previous?.site[key]?.value)}</dd>
        </div>)}
      </dl>
      <div className={styles.scroll}>
        <table>
          <caption>按进入会话时的着陆页统计板块流量</caption>
          <thead><tr><th scope="col">板块</th><th scope="col">总会话</th><th scope="col">自然搜索会话</th></tr></thead>
          <tbody>{TRAFFIC_SUMMARY_MODULES.map(([key, label]) => <tr key={key}>
            <th scope="row">{label}</th>
            <td>{number(day?.modules[key].totalSessions?.value)}</td>
            <td>{number(day?.modules[key].organicSessions?.value)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className={styles.note}>全站会话含正式官网与 Console。注册按 Flatkey GA4 属性内当天触发成功事件的用户去重，自然搜索注册按首次获客渠道归因。破折号表示当天缺数据。</p>
    </> : null}
  </ChartPanel>;
}
