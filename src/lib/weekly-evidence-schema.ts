import { z } from "zod";
import { weeklyPageVisitorsSchema } from "./weekly-page-visitors";
const count = z.number().int().min(0), pair = z.object({current:count,previous:count}).strict();
const step = z.object({name:z.string().min(1).max(100),users:count,completionRate:z.number().min(0).max(1).nullable()}).strict();
const funnel = z.object({current:z.array(step).min(2).max(10),previous:z.array(step).min(2).max(10)}).strict().superRefine((data,ctx)=>{
  if (data.current.length !== data.previous.length || data.current.some((row,index)=>row.name !== data.previous[index]?.name)) ctx.addIssue({code:"custom",message:"两期漏斗步骤必须一致"});
  for (const rows of [data.current,data.previous]) if(rows.some((row,index)=>index>0&&row.users>rows[index-1].users)) ctx.addIssue({code:"custom",message:"顺序漏斗人数不能逐步增加"});
});
export const weeklyEvidenceSchema = z.object({
  complete:z.literal(true),
  pageVisitors:weeklyPageVisitorsSchema.optional(),
  codexSummary:z.object({preparedAt:z.iso.datetime({offset:true}).refine(value=>Date.parse(value)<=Date.now()+300000),text:z.string().trim().min(1).max(800).optional(),findings:z.array(z.object({title:z.string().trim().min(1).max(80),evidence:z.string().trim().min(1).max(500),action:z.string().trim().min(1).max(300),level:z.enum(["issue","finding","unresolved"])}).strict()).min(1).max(6)}).strict().optional(),
  totals:z.object({current:z.object({newUsers:count,newRegistrations:count}).strict(),previous:z.object({newUsers:count,newRegistrations:count}).strict()}).strict(),
  channels:z.array(z.object({name:z.string().min(1).max(100),newUsers:pair,registrations:pair}).strict()).max(50),
  formFunnel:funnel.optional(),newVisitorFunnel:funnel.optional(),
  directRegistrationCountries:z.record(z.string().max(100),pair).optional(),
  search:z.object({clicks:pair,impressions:pair,decliningPages:z.array(z.object({url:z.url(),clicks:pair,position:z.object({current:z.number().min(1).nullable(),previous:z.number().min(1).nullable()}).strict()}).strict()).max(20)}).strict().optional(),
  sources:z.array(z.url().refine(value=>{const url=new URL(value);return url.protocol==="https:"&&!url.username&&!url.password&&["analytics.google.com","search.google.com"].includes(url.hostname);})).min(1).max(20),
}).strict().superRefine((data,ctx)=>{
  if(new Set(data.channels.map(row=>row.name)).size!==data.channels.length)ctx.addIssue({code:"custom",message:"渠道不能重复"});
  for(const period of ["current","previous"] as const) {
    if(data.channels.reduce((sum,row)=>sum+row.newUsers[period],0)!==data.totals[period].newUsers ||
      data.channels.reduce((sum,row)=>sum+row.registrations[period],0)!==data.totals[period].newRegistrations)ctx.addIssue({code:"custom",message:"渠道人数须与同期全渠道汇总一致，不能用事件次数代替注册人数"});
  }
});
