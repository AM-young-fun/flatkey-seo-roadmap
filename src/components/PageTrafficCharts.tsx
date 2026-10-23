"use client";
import { useEffect, useRef, useState } from "react";
import { Select } from "antd";
import type * as echarts from "echarts";
import { PAGE_TRAFFIC_GROUPS, pageTrafficWindow, type PageTrafficRange, type PageTrafficSeries } from "@/lib/page-traffic-history";
function TrafficLine({series}:{series:PageTrafficSeries[number]}) {
  const element=useRef<HTMLDivElement>(null);
  const points=series.points;
  const signature=JSON.stringify(points);
  useEffect(()=>{
    if(!element.current||!points.length)return;
    const target=element.current;let disposed=false,chart:echarts.ECharts|undefined,observer:ResizeObserver|undefined;
    const byDate=new Map(points.map(p=>[p.date,p]));
    // Include calendar gaps as null; missing collection must never look like zero.
    const dates:string[]=[];for(let day=Date.parse(points[0].date);day<=Date.parse(points.at(-1)!.date);day+=86400000)dates.push(new Date(day).toISOString().slice(0,10));
    const option:echarts.EChartsOption={animation:false,color:[series.color],grid:{left:48,right:24,top:30,bottom:38},tooltip:{trigger:"axis",renderMode:"richText",confine:true,formatter:(raw:unknown)=>{const p=byDate.get((raw as {axisValue:string}[])[0]?.axisValue);return p?`${p.date}\n去重访客：${p.users??"未采集"} 人\n浏览次数：${p.pageViews??"未采集"}\n采集：${new Date(p.collectedAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}`:"未采集";}},xAxis:{type:"category",boundaryGap:false,data:dates,axisLabel:{formatter:(v:string)=>v.slice(5),color:"#8795a9"},axisLine:{lineStyle:{color:"#e5eaf2"}}},yAxis:{type:"value",min:0,minInterval:1,name:"访客 / 人",splitLine:{lineStyle:{color:"#eef2f7"}}},series:[{type:"line",name:series.name,data:dates.map(d=>byDate.get(d)?.users??null),connectNulls:false,symbolSize:5,lineStyle:{width:2},areaStyle:{opacity:0.06}}]};
    void import("@/lib/charts").then(({init})=>{if(disposed)return;chart=init(target);chart.setOption(option);observer=new ResizeObserver(()=>chart?.resize());observer.observe(target);});
    return()=>{disposed=true;observer?.disconnect();chart?.dispose();};
  // signature tracks the selected data without rebuilding on unrelated report updates.
  },[signature,series.color,series.name]);
  return <section className="dailyPanel pageTrafficCard" aria-label={`${series.name}流量趋势`}><div className="dailyHeading"><div><h2>{series.name}</h2><p className="chartNote">每日去重访客 · 含各语言版本{points.length?` · ${points[0].date} — ${points.at(-1)!.date}`:""}</p></div></div>{points.length?<><div ref={element} className="pageTrafficPlot" role="img" aria-label={`${series.name}每日访客折线图，共${points.length}天，鼠标悬停查看数据`}/><details className="pageTrafficDetails"><summary>查看每日数据</summary><div className="siteTrafficTable"><table><thead><tr><th>日期</th><th>访客</th><th>浏览次数</th></tr></thead><tbody>{points.map(p=><tr key={p.date}><td>{p.date}</td><td>{p.users??"未采集"}</td><td>{p.pageViews??"未采集"}</td></tr>)}</tbody></table></div></details></>:<p className="muted">尚无已保存的每日数据，采集后持续累积。</p>}</section>;
}
export function PageTrafficCharts({series}:{series?:PageTrafficSeries}) {
  const [range,setRange]=useState<PageTrafficRange>("all");
  const groups=series??PAGE_TRAFFIC_GROUPS.map(g=>({...g,timezone:null,points:[]}));
  const window=pageTrafficWindow(groups,range);
  const rangeLabel={all:"全部历史",7:"最近一周",21:"最近三周",90:"最近90天"}[range];
  return <section className="pageTrafficHistory" aria-label="核心页面历史流量曲线"><div className="pageTrafficHeading"><div><h2>核心页面流量趋势</h2><p className="chartNote">每日去重访客 · 历史持续保留，每周新增 · 未取得数据的日期断线显示。</p></div><div className="pageTrafficRange"><span id="traffic-range-label">时间范围</span><Select<PageTrafficRange> aria-label="流量曲线时间范围" className="originSelect" value={range} onChange={setRange} options={[{value:"all",label:"全部历史"},{value:"7",label:"最近一周"},{value:"21",label:"最近三周"},{value:"90",label:"最近90天"}]} /></div></div><div className="pageTrafficWindow" role="status" aria-live="polite">{!series?"正在读取历史数据…":window.days?<><strong>{rangeLabel}：{window.start} — {window.end} · {window.days}天</strong>{window.sameAsAll?<span>现有历史只覆盖这{window.days}天，因此与“全部历史”相同；后续每周追加后会自动延长。</span>:null}</>:"尚无已保存的每日数据"}</div><div className="pageTrafficCards">{window.series.map(g=><TrafficLine key={g.key} series={g}/>)}</div></section>;
}
