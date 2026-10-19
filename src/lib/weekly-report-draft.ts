import { z } from "zod";
import { isWeeklyPeriod, reportPeriods } from "./weekly-traffic";
import { weeklyEvidenceSchema } from "./weekly-evidence-schema";

const day = z.iso.date(), count = z.number().int().nonnegative();
const source = z.url().refine(value => { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && url.hostname === "analytics.google.com"; });
const finding = z.object({ title:z.string().min(1).max(150), evidence:z.string().min(1).max(1500), action:z.string().min(1).max(1000), level:z.enum(["issue","finding","unresolved"]), url:source.optional() }).strict();
const window = z.object({start:day,end:day}).strict();
export const weeklyReportDraftSchema = z.object({
  kind:z.literal("weekly-report-draft"), siteDomain:z.literal("flatkey.ai"),
  periodStart:day, periodEnd:day, timezone:z.literal("America/Los_Angeles"), ga4PropertyId:z.literal("541304395"),
  collectedAt:z.iso.datetime({offset:true}),
  stageTotals:z.object({newUsers:count,newRegistrations:count,collectedAt:z.iso.datetime({offset:true})}).strict(),
  comparisonPeriods:z.object({current:window,previous:window}).strict(),
  evidence:weeklyEvidenceSchema,
  findings:z.array(finding).max(15),
  otherSites:z.array(z.object({siteDomain:z.enum(["rackrate.org","modelfit.cc"]),newUsers:count,previousNewUsers:count,
    registrationStatus:z.literal("UNVERIFIED"),sourceUrl:source}).strict()).max(2).default([]),
}).strict().superRefine((data,ctx)=>{
  const issue=(message:string)=>ctx.addIssue({code:"custom",message});
  if(!isWeeklyPeriod(data.periodStart,data.periodEnd))issue("草稿必须属于周二至周一的一期周报");
  const stamp=Date.parse(data.collectedAt), today=new Intl.DateTimeFormat("en-CA",{timeZone:data.timezone}).format(new Date(stamp));
  if(stamp>Date.now()+300000 || Date.parse(data.stageTotals.collectedAt)>stamp || data.periodStart>today)issue("草稿采集时间无效");
  const {current,previous}=data.comparisonPeriods, days=(a:string,b:string)=>(Date.parse(b)-Date.parse(a))/86400000;
  const previousWeek=reportPeriods(data.periodStart).previous;
  if(current.start<data.periodStart || current.end>data.periodEnd || current.end>=today || current.start>current.end ||
    previous.start<previousWeek.start || previous.end>previousWeek.end || previous.start>previous.end ||
    days(current.start,current.end)!==days(previous.start,previous.end) || days(previous.start,current.start)!==7 || days(previous.end,current.end)!==7)
    issue("阶段诊断只能对比已经结束、相隔一周且长度相同的日期");
  if(data.stageTotals.newUsers<data.evidence.totals.current.newUsers || data.stageTotals.newRegistrations<data.evidence.totals.current.newRegistrations)issue("整期阶段累计不得少于已结束子区间人数");
  if(new Set(data.otherSites.map(row=>row.siteDomain)).size!==data.otherSites.length)issue("网站不能重复");
});
export type WeeklyReportDraftPayload = z.infer<typeof weeklyReportDraftSchema>;
