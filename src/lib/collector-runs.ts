import { z } from "zod";
export const sourceCheckSchema=z.object({sourceId:z.enum(["api_main","cloud_main","optimization"]),status:z.enum(["COMPLETED","FAILED"]),rows:z.number().int().min(0).max(100000)}).strict();
export const collectorRunSchema=z.object({kind:z.enum(["SHEETS","GA4","AHREFS"]),periodStart:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value),status:z.enum(["RUNNING","COMPLETED","PARTIAL","FAILED"]),checkedItems:z.number().int().min(0).max(100000).default(0),sourceChecks:z.array(sourceCheckSchema).max(3).optional(),detail:z.string().trim().max(500).optional()}).strict().superRefine((value,ctx)=>{
  if(value.kind==="SHEETS"&&value.status==="COMPLETED"&&(!value.sourceChecks||value.sourceChecks.length!==3||new Set(value.sourceChecks.map(row=>row.sourceId)).size!==3||value.sourceChecks.some(row=>row.status!=="COMPLETED")))ctx.addIssue({code:"custom",message:"三表均完整读取后才能标完成"});
  if(value.kind==="GA4"&&new Date(value.periodStart).getUTCDay()!==2)ctx.addIssue({code:"custom",message:"GA4 周期必须从周二开始"});
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai"}).format(new Date());
  if(value.periodStart>today)ctx.addIssue({code:"custom",message:"不能提前记录未来采集"});
});
export const collectorRunId=(kind:string,periodStart:string)=>`codex.${kind.toLowerCase()}.${periodStart}`;
export type CollectorRunPayload=z.infer<typeof collectorRunSchema>;
