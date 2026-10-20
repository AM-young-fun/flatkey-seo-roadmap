"use client";
import { useState } from "react";
import { rankingImportSchema, MAX_IMPORT_BYTES, type RankingImportPayload } from "@/lib/ranking-import";
import { weeklyReportDraftSchema, type WeeklyReportDraftPayload } from "@/lib/weekly-report-draft";
import { collectorRunSchema,type CollectorRunPayload } from "@/lib/collector-runs";
import { sourceSyncSchema, type SourceSyncPayload, type SourceSyncResult } from "@/lib/source-sync";

type CollectorPayload=RankingImportPayload|WeeklyReportDraftPayload|CollectorRunPayload|SourceSyncPayload;
const isDraft=(payload:CollectorPayload):payload is WeeklyReportDraftPayload=>"kind" in payload && payload.kind === "weekly-report-draft";
const isReceipt=(payload:CollectorPayload):payload is CollectorRunPayload=>"kind" in payload && ["SHEETS","GA4","AHREFS"].includes(payload.kind);
const isSource=(payload:CollectorPayload):payload is SourceSyncPayload=>"kind" in payload && payload.kind === "source-sync";

// Collector-only file intake. Kept out of the daily dashboard navigation.
export default function CollectorPage() {
  const [payload,setPayload]=useState<CollectorPayload|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[rawText,setRawText]=useState("");
  const [sourcePreview,setSourcePreview]=useState<SourceSyncResult|null>(null);
  function preview(source:string) {
    setPayload(null);setMessage("");setSourcePreview(null);
    try {
      if(new TextEncoder().encode(source).byteLength>MAX_IMPORT_BYTES)throw new Error("内容超过2MB，请分批导入");
      const raw=JSON.parse(source),result=raw.kind === "source-sync" ? sourceSyncSchema.safeParse({...raw,action:"preview",expectedStateHash:undefined}) : raw.kind === "weekly-report-draft" ? weeklyReportDraftSchema.safeParse(raw) : ["SHEETS","GA4","AHREFS"].includes(raw.kind)?collectorRunSchema.safeParse(raw):rankingImportSchema.safeParse(raw);
      if(result.success && isSource(result.data) && (result.data.rows.length < 1 || result.data.rows.length > 30))throw new Error("来源同步每批 1–30 行");
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
    const sourceAction=sourcePreview?"apply":"preview";
    const body=isSource(payload)?{...payload,action:sourceAction,expectedStateHash:sourcePreview?.stateHash}:payload;
    try {const response=await fetch(isSource(payload)?"/api/keywords/source-sync":isDraft(payload)?"/api/weekly-report/draft":isReceipt(payload)?"/api/collectors/runs":"/api/seo/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const result=await response.json();if(!response.ok)throw new Error(result.message??"导入失败");
      if(isSource(payload)) {
        if(result.kind!=="source-sync"||result.requestId!==payload.requestId||result.sourceId!==payload.sourceId||result.action!==sourceAction||!/^[a-f0-9]{64}$/.test(result.stateHash))throw new Error("来源同步回执不匹配，请重新预览");
        if(sourceAction==="preview"){setSourcePreview(result);setMessage(`来源预览完成 · 变更 ${result.sourceSummary.changedRows} 行 · 未变 ${result.sourceSummary.unchangedRows} 行`);return;}
      }
      setMessage(isReceipt(payload)?`采集回执已保存 · ${result.status}`:`${result.duplicate?isDraft(payload)?"已有相同或更新的数据，未覆盖":"该批已导入，未重复写入":"导入完成"} · ${result.imported} 条`);setPayload(null);setRawText("");setSourcePreview(null);
    } catch(error){setSourcePreview(null);setMessage(error instanceof Error?error.message:"导入失败");}finally{setBusy(false);}
  }
  return <main className="appShell"><section className="dailyPanel"><h1>采集数据导入</h1><p>仅接收已核对的来源文件，使用当前登录会话保存数据。</p><input type="file" aria-label="选择采集JSON文件" accept="application/json,.json" disabled={busy} onChange={event=>void load(event.target.files?.[0])}/>
    <details style={{marginTop:20}}><summary>粘贴采集JSON</summary><textarea aria-label="粘贴采集JSON" value={rawText} disabled={busy} onChange={event=>{setRawText(event.target.value);setPayload(null);setSourcePreview(null);}} style={{display:"block",width:"100%",minHeight:160,marginBlock:12}}/><button disabled={busy||!rawText.trim()} onClick={()=>preview(rawText)}>预览数据</button></details>
    {payload?<div>{isDraft(payload)?<><p>网站：{payload.siteDomain} · 周报草稿 {payload.periodStart} — {payload.periodEnd}</p><p>阶段累计 {payload.stageTotals.newUsers} 位新用户、{payload.stageTotals.newRegistrations} 位注册；等长诊断 {payload.comparisonPeriods.current.start} — {payload.comparisonPeriods.current.end}。仅保存草稿，不写入完整周报。</p></>:isReceipt(payload)?<p>Codex 采集回执 · {payload.kind} · {payload.periodStart} · {payload.status} · 核对 {payload.checkedItems} 项</p>:isSource(payload)?<><p>来源：{payload.sourceId} · {payload.rows.length} 行 · 批次：{payload.requestId}</p>{sourcePreview?<><p>新关键词 {sourcePreview.sourceSummary.newKeywords} · 新关联 {sourcePreview.sourceSummary.newMemberships} · 保留冲突 {sourcePreview.sourceSummary.conflicts}</p><details><summary>逐项变更</summary><pre style={{whiteSpace:"pre-wrap"}}>{JSON.stringify(sourcePreview,null,2)}</pre></details></>:null}</>:<><p>网站：{payload.targetDomain} · 批次：{payload.requestId}</p><p>周报 {payload.traffic.length} 期 · 关键词 {payload.observations.length} 条 · 页面 {payload.pages.length} 条</p></>}<button disabled={busy} onClick={()=>void apply()}>{busy?"正在导入…":isSource(payload)?sourcePreview?"应用来源变更":"预览来源变更":"保存采集数据"}</button></div>:null}
    {message?<p role="status">{message}</p>:null}</section></main>;
}
