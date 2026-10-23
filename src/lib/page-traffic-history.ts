import { z } from "zod";
const locale = "(?:/(?:en|zh|es|fr|pt|ru|ja|vi|de|id))?";
export const PAGE_TRAFFIC_GROUPS = [
  {key:"models",name:"模型详情＋模型列表",pathPattern:`^${locale}/models(?:/[^/]+)?/?$`,color:"#4385ff"},
  {key:"compute",name:"GPU Compute",pathPattern:`^${locale}/compute(?:/.*)?/?$`,color:"#10b981"},
  {key:"prompts",name:"Prompt Library",pathPattern:`^${locale}/(?:prompts(?:/.*)?|models/[^/]+/prompts(?:/.*)?)/?$`,color:"#a371ef"},
] as const;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value);
export const pageTrafficHistorySchema = z.object({
  metric:z.literal("totalUsers"),eventName:z.literal("page_view"),ruleVersion:z.literal(1),
  timezone:z.string().refine(value=>{try{new Intl.DateTimeFormat("en",{timeZone:value});return true;}catch{return false;}}),
  sourceUrl:z.url().refine(value=>{const u=new URL(value);return u.protocol==="https:"&&u.hostname==="analytics.google.com"&&!u.username&&!u.password;}),
  groups:z.array(z.object({key:z.enum(["models","compute","prompts"]),points:z.array(z.object({date,users:z.number().int().nonnegative().nullable(),pageViews:z.number().int().nonnegative().nullable()}).strict()).min(1).max(366)}).strict()).length(3),
}).strict().superRefine((value,ctx)=>{
  if(new Set(value.groups.map(g=>g.key)).size!==3)ctx.addIssue({code:"custom",message:"三类页面组必须各有一条曲线"});
  for(const group of value.groups)if(new Set(group.points.map(p=>p.date)).size!==group.points.length)ctx.addIssue({code:"custom",message:"同一组不能重复日期"});
});
export type PageTrafficHistory = z.infer<typeof pageTrafficHistorySchema>;
export type PageTrafficSeries = {key:string;name:string;color:string;timezone:string|null;points:{date:string;users:number|null;pageViews:number|null;collectedAt:string;sourceUrl:string}[]}[];
// WeeklyTraffic is append-only. Merge every saved week, never just the two
// comparison weeks or a browser cache. A missing new sample cannot erase an old one.
export function mergePageTrafficHistory(rows:{analysis:unknown;collectedAt:Date}[],end:string):PageTrafficSeries {
  const parsed=rows.map(row=>({row,data:pageTrafficHistorySchema.safeParse((row.analysis as {pageTrends?:unknown}|null)?.pageTrends)})).filter(item=>item.data.success).sort((a,b)=>a.row.collectedAt.getTime()-b.row.collectedAt.getTime());
  const timezone=parsed.at(-1)?.data.data?.timezone??null;
  return PAGE_TRAFFIC_GROUPS.map(group=>{
    const points=new Map<string,PageTrafficSeries[number]["points"][number]>();
    for(const {row,data} of parsed)if(data.success&&data.data.timezone===timezone)for(const p of data.data.groups.find(g=>g.key===group.key)!.points){
      if(p.date>end||p.users===null&&points.has(p.date))continue;
      points.set(p.date,{...p,collectedAt:row.collectedAt.toISOString(),sourceUrl:data.data.sourceUrl});
    }
    return {...group,timezone,points:[...points.values()].sort((a,b)=>a.date.localeCompare(b.date))};
  });
}

export type PageTrafficRange = "all" | "7" | "21" | "90";
export function pageTrafficWindow(series:PageTrafficSeries,range:PageTrafficRange) {
  const dates=series.flatMap(group=>group.points.map(point=>point.date)).sort();
  const availableStart=dates[0]??null,end=dates.at(-1)??null;
  const requestedStart=end&&range!=="all"?new Date(Date.parse(end)-(Number(range)-1)*86400000).toISOString().slice(0,10):availableStart;
  const start=availableStart&&requestedStart?(availableStart>requestedStart?availableStart:requestedStart):null;
  const days=start&&end?Math.round((Date.parse(end)-Date.parse(start))/86400000)+1:0;
  return {start,end,days,sameAsAll:range!=="all"&&Boolean(start&&start===availableStart),series:series.map(group=>({...group,points:group.points.filter(point=>Boolean(start&&end&&point.date>=start&&point.date<=end))}))};
}
