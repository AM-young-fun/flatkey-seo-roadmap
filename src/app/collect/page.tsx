"use client";
import { useState } from "react";
import { rankingImportSchema, MAX_IMPORT_BYTES, type RankingImportPayload } from "@/lib/ranking-import";
import { weeklyReportDraftSchema, type WeeklyReportDraftPayload } from "@/lib/weekly-report-draft";

type CollectorPayload=RankingImportPayload|WeeklyReportDraftPayload;
const isDraft=(payload:CollectorPayload):payload is WeeklyReportDraftPayload=>"kind" in payload && payload.kind === "weekly-report-draft";

// Collector-only file intake. Kept out of the daily dashboard navigation.
export default function CollectorPage() {
  const [payload,setPayload]=useState<CollectorPayload|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[rawText,setRawText]=useState("");
  function preview(source:string) {
    setPayload(null);setMessage("");
    try {
      if(new TextEncoder().encode(source).byteLength>MAX_IMPORT_BYTES)throw new Error("内容超过2MB，请分批导入");
      const raw=JSON.parse(source),result=raw.kind === "weekly-report-draft" ? weeklyReportDraftSchema.safeParse(raw) : rankingImportSchema.safeParse(raw);
      if(!result.success)throw new Error(result.error.issues.map(issue=>issue.message).slice(0,3).join("；"));setPayload(result.data);
    }catch(error){setMessage(error instanceof Error?error.message:"数据格式无效");}
  }
  async function load(file?: File) {
    setPayload(null);setMessage("");if(!file)return;
    try {if(file.size>MAX_IMPORT_BYTES)throw new Error("文件超过2MB，请分批导入");
      preview(await file.text());
    } catch(error){setMessage(error instanceof Error?error.message:"文件格式无效");}
  }
  async function apply() {
    if(!payload)return;setBusy(true);setMessage("");
    try {const response=await fetch(isDraft(payload)?"/api/weekly-report/draft":"/api/seo/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const result=await response.json();if(!response.ok)throw new Error(result.message??"导入失败");setMessage(`${result.duplicate?isDraft(payload)?"已有相同或更新的数据，未覆盖":"该批已导入，未重复写入":"导入完成"} · ${result.imported} 条`);setPayload(null);setRawText("");
    } catch(error){setMessage(error instanceof Error?error.message:"导入失败");}finally{setBusy(false);}
  }
  return <main className="appShell"><section className="dailyPanel"><h1>采集数据导入</h1><p>仅接收已核对的来源文件，使用当前登录会话保存数据。</p><input type="file" aria-label="选择采集JSON文件" accept="application/json,.json" disabled={busy} onChange={event=>void load(event.target.files?.[0])}/>
    <details style={{marginTop:20}}><summary>粘贴采集JSON</summary><textarea aria-label="粘贴采集JSON" value={rawText} disabled={busy} onChange={event=>{setRawText(event.target.value);setPayload(null);}} style={{display:"block",width:"100%",minHeight:160,marginBlock:12}}/><button disabled={busy||!rawText.trim()} onClick={()=>preview(rawText)}>预览数据</button></details>
    {payload?<div>{isDraft(payload)?<><p>网站：{payload.siteDomain} · 周报草稿 {payload.periodStart} — {payload.periodEnd}</p><p>阶段累计 {payload.stageTotals.newUsers} 位新用户、{payload.stageTotals.newRegistrations} 位注册；等长诊断 {payload.comparisonPeriods.current.start} — {payload.comparisonPeriods.current.end}。仅保存草稿，不写入完整周报。</p></>:<><p>网站：{payload.targetDomain} · 批次：{payload.requestId}</p><p>周报 {payload.traffic.length} 期 · 关键词 {payload.observations.length} 条 · 页面 {payload.pages.length} 条</p></>}<button disabled={busy} onClick={()=>void apply()}>{busy?"正在导入…":"保存采集数据"}</button></div>:null}
    {message?<p role="status">{message}</p>:null}</section></main>;
}
