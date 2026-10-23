import type { WeeklyReportDiagnosis } from "./weekly-report-diagnosis";
import type { WeeklyTrafficEvidence } from "./weekly-traffic-evidence";
import { pageVisitorRows } from "./weekly-page-visitors";
import { weeklyFunnelMetrics } from "./weekly-funnel-metrics";

type Totals = {newUsers:number;newRegistrations:number};
type SummaryInput = {current:Totals|null;previous:Totals|null;comparable:boolean;diagnosis:WeeklyReportDiagnosis;evidence?:WeeklyTrafficEvidence|null;
  comparison?:{current:number;net:number}|null;ranking?:{waiting:boolean;captureWeek:boolean;baseline:boolean;noNewCapture:boolean;comparisonReference?:unknown}|null};
const count=(value:number)=>value.toLocaleString("zh-CN");
const trend=(current:number,previous:number)=>previous===0?current===0?"与上期持平":`较上期增加 ${count(current)} 人`:current===previous?"与上期持平":`较上期${current>previous?"增长":"减少"} ${(Math.abs(current-previous)/previous*100).toFixed(1)}%`;

// Reuse saved facts only. Unresolved investigations and action lists remain
// in the private evidence, rather than becoming the report's conclusion.
export function weeklySummaryText(input:SummaryInput):string {
  const prepared=input.evidence?.codexSummary?.text?.trim();
  if(prepared)return prepared.replace(/\s+/gu," ");
  const parts:string[]=[];
  if(input.current){
    const {current,previous}=input;
    parts.push(input.comparable&&previous?`本期新用户 ${count(current.newUsers)} 人，${trend(current.newUsers,previous.newUsers)}；注册 ${count(current.newRegistrations)} 人，${trend(current.newRegistrations,previous.newRegistrations)}。`:`本期新用户 ${count(current.newUsers)} 人，注册 ${count(current.newRegistrations)} 人。`);
    const funnel=weeklyFunnelMetrics(input.evidence?.newVisitorFunnel);
    if(input.comparable&&funnel&&funnel.current.rate!==null&&funnel.previous.rate!==null)parts.push(`新访客注册转化率由 ${(funnel.previous.rate*100).toFixed(1)}% ${funnel.current.rate===funnel.previous.rate?"维持在":funnel.current.rate>funnel.previous.rate?"升至":"降至"} ${(funnel.current.rate*100).toFixed(1)}%。`);
  }
  const shares=pageVisitorRows(input.evidence?.pageVisitors, input.comparable).filter(row=>row.currentShare!==null);
  if(shares.length)parts.push(shares.map(row=>`${row.name}访客占全站 ${(row.currentShare!*100).toFixed(1)}%${row.sharePoints===null?"":`，较上期${row.sharePoints>=0?"增加":"减少"} ${Math.abs(row.sharePoints).toFixed(1)} 个百分点`}`).join("；")+"。");
  const conclusions=input.diagnosis.findings.filter(row=>row.level!=="unresolved"&&!/待确认|待核|尚未|暂无|缺少.*证据|技术根因|表单|排查/u.test(row.title)).slice(0,2).map(row=>{
    const text=/变化$|集中位置$|渠道变化/u.test(row.title)?row.evidence.split("。")[0]:row.title;
    return text.replace(/[。；]$/u,"");
  }).filter(Boolean);
  if(conclusions.length)parts.push(`${[...new Set(conclusions)].join("；")}。`);
  const {ranking,comparison}=input;
  if(ranking&&!ranking.waiting&&comparison){
    if(!ranking.captureWeek)parts.push("本周未安排关键词采集，沿用最近一期结果。");
    else if(ranking.comparisonReference)parts.push(`本期 ${count(comparison.current)} 个词进入前100；两期采集范围不同，新增不直接视为自然排名增长。`);
    else if(ranking.baseline)parts.push(`首次实测有 ${count(comparison.current)} 个词进入前100，作为后续对比基线。`);
    else if(!ranking.noNewCapture)parts.push(`前100排名词 ${count(comparison.current)} 个，${comparison.net===0?"与上期持平":`较上期净${comparison.net>0?"增":"减"} ${count(Math.abs(comparison.net))} 个`}。`);
  }
  return parts.join("");
}
