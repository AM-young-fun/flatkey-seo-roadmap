"use client";
import { useEffect, useRef, useState } from "react";
import { Select } from "antd";
import type * as echarts from "echarts";
import { PAGE_TRAFFIC_GROUPS, pageTrafficWindow, type PageTrafficRange, type PageTrafficSeries } from "@/lib/page-traffic-history";
type Granularity = "week" | "day";
function TrafficLine({series,granularity,loading}:{series:PageTrafficSeries[number];granularity:Granularity;loading:boolean}) {
  const element=useRef<HTMLDivElement>(null);
  const weekly=granularity==="week";
  const points=weekly?(series.weeks??[]).map(w=>({...w,date:w.periodStart,label:`${w.periodStart.slice(5)}—${w.periodEnd.slice(5)}`})):series.points.map(p=>({...p,label:p.date.slice(5),registrationFunnel:undefined}));
  const signature=JSON.stringify(points);
  useEffect(()=>{
    if(!element.current||!points.length)return;
    const target=element.current;let disposed=false,chart:echarts.ECharts|undefined,observer:ResizeObserver|undefined;
    const byDate=new Map(points.map(p=>[p.date,p]));
    const dates:string[]=[];for(let day=Date.parse(points[0].date);day<=Date.parse(points.at(-1)!.date);day+=(weekly?7:1)*86400000)dates.push(new Date(day).toISOString().slice(0,10));
    const option:echarts.EChartsOption={animation:false,color:[series.color],legend:{show:weekly,top:0,left:"center",data:["去重访客","访问后注册人数"],textStyle:{fontSize:11,color:"#70819a"}},grid:{left:52,right:weekly?58:24,top:weekly?54:30,bottom:38},tooltip:{trigger:"axis",renderMode:"richText",confine:true,formatter:(raw:unknown)=>{const p=byDate.get((raw as {axisValue:string}[])[0]?.axisValue);return p?`${weekly?"周区间":"日期"}：${p.label}\n${weekly?"整周":"当日"}去重访客：${p.users??"未采集"} 人${weekly?`\n访问后注册人数：${p.registrationFunnel?.users??"未采集"}`:""}\n浏览次数：${p.pageViews??"未采集"}\n访客采集：${new Date(p.collectedAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}${weekly&&p.registrationFunnel?`\n注册采集：${new Date(p.registrationFunnel.collectedAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}`:""}`:"未采集";}},xAxis:{type:"category",boundaryGap:false,data:dates,axisLabel:{formatter:(v:string)=>byDate.get(v)?.label??v.slice(5),color:"#8795a9"},axisLine:{lineStyle:{color:"#e5eaf2"}}},yAxis:[{type:"value",min:0,minInterval:1,name:"访客人数",splitLine:{lineStyle:{color:"#eef2f7"}}},{type:"value",show:weekly,position:"right",min:0,minInterval:1,name:"注册人数",axisLabel:{color:"#e9903c"},splitLine:{show:false}}],series:[{type:"line",name:"去重访客",data:dates.map(d=>byDate.get(d)?.users??null),connectNulls:false,symbolSize:weekly?8:5,label:{show:weekly,position:"top",formatter:"{c}",color:series.color,fontSize:12},lineStyle:{width:2},areaStyle:{opacity:0.06}},...(weekly?[{type:"line" as const,name:"访问后注册人数",yAxisIndex:1,data:dates.map(d=>byDate.get(d)?.registrationFunnel?.users??null),connectNulls:false,symbolSize:8,lineStyle:{width:2,color:"#ed9645"},itemStyle:{color:"#ed9645"},label:{show:true,position:"top" as const,formatter:"{c}",color:"#d57c2a",fontSize:12}}]:[])]};
    void import("@/lib/charts").then(({init})=>{if(disposed)return;chart=init(target);chart.setOption(option);observer=new ResizeObserver(()=>chart?.resize());observer.observe(target);});
    return()=>{disposed=true;observer?.disconnect();chart?.dispose();};
  },[signature,series.color,series.name,weekly]);
  const unit=weekly?"周":"天";
  return <section className="dailyPanel pageTrafficCard" aria-label={`${series.name}流量趋势`}>
    <div className="dailyHeading"><div><h2>{series.name}</h2><p className="chartNote">{weekly?"每周访客（左轴）与注册人数（右轴）· 周五至周四":"每日去重访客"} · 含各语言版本{points.length?` · ${points.length}${unit}`:""}</p></div></div>
    {points.length?<><div ref={element} className="pageTrafficPlot" role="img" aria-label={`${series.name}每${unit}访客折线图，共${points.length}${unit}，鼠标悬停查看数据`}/>
      <details className="pageTrafficDetails"><summary>查看{weekly?"每周":"每日"}数据</summary><div className="siteTrafficTable"><table><thead><tr><th>{weekly?"周区间":"日期"}</th><th>去重访客</th><th>浏览次数</th>{weekly?<th>访问后注册人数</th>:null}</tr></thead><tbody>{points.map(p=><tr key={p.date}><td>{weekly?p.label:p.date}</td><td>{p.users??"未采集"}</td><td>{p.pageViews??"未采集"}</td>{weekly?<td>{p.registrationFunnel?.users??"未采集"}</td>:null}</tr>)}</tbody></table></div></details>{weekly?<p className="chartNote pageConversionNote">注册人数按同周先访问本页面组、再完成注册去重统计；页面组之间可重叠。</p>:null}</>:<p className="muted">{loading?"正在读取已保存的流量数据…":weekly?"周汇总待采集，不能将每日访客相加代替。":"尚无已保存的每日数据，采集后持续累积。"}</p>}
  </section>;
}
export function PageTrafficCharts({series}:{series?:PageTrafficSeries}) {
  const [range,setRange]=useState<PageTrafficRange>("all");
  const [granularity,setGranularity]=useState<Granularity>("week");
  const groups=series??PAGE_TRAFFIC_GROUPS.map(g=>({...g,timezone:null,points:[]}));
  const window=pageTrafficWindow(groups,range);
  const rangeLabel={all:"全部历史",7:"最近一周",21:"最近三周",90:"最近90天"}[range];
  return <section className="pageTrafficHistory" aria-label="核心页面历史流量曲线">
    <div className="pageTrafficHeading"><div><h2>核心页面流量趋势</h2><p className="chartNote">每周追加，保留全部历史 · 周访客直接取GA4整周去重总数。</p></div>
      <div className="pageTrafficControls"><div className="channelMetricSwitch" role="group" aria-label="流量统计周期">{([{key:"week",label:"按周汇总"},{key:"day",label:"按天查看"}] as const).map(item=><button key={item.key} type="button" aria-pressed={granularity===item.key} onClick={()=>setGranularity(item.key)}>{item.label}</button>)}</div>
        <div className="pageTrafficRange"><span>时间范围</span><Select<PageTrafficRange> aria-label="流量曲线时间范围" className="originSelect" value={range} onChange={setRange} options={[{value:"all",label:"全部历史"},{value:"7",label:"最近一周"},{value:"21",label:"最近三周"},{value:"90",label:"最近90天"}]} /></div>
      </div>
    </div>
    <div className="pageTrafficWindow" role="status" aria-live="polite">{!series?"正在读取历史数据…":window.days?<><strong>{rangeLabel}：{window.start} — {window.end} · {window.days}天 · {granularity==="week"?"按周汇总":"按天查看"}</strong>{window.sameAsAll?<span>现有历史只覆盖这{window.days}天，因此与“全部历史”相同；后续每周追加后会自动延长。</span>:null}</>:"尚无已保存的流量数据"}</div>
    <div className="pageTrafficCards">{window.series.map(g=><TrafficLine key={g.key} series={g} granularity={granularity} loading={!series}/>)}</div>
  </section>;
}
