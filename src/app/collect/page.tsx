"use client";
import { useState } from "react";
import { rankingImportSchema, MAX_IMPORT_BYTES, type RankingImportPayload } from "@/lib/ranking-import";

// Collector-only file intake. Kept out of the daily dashboard navigation.
export default function CollectorPage() {
  const [payload,setPayload]=useState<RankingImportPayload|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  async function load(file?: File) {
    setPayload(null);setMessage("");if(!file)return;
    try {if(file.size>MAX_IMPORT_BYTES)throw new Error("文件超过2MB，请分批导入");
      const result=rankingImportSchema.safeParse(JSON.parse(await file.text()));
      if(!result.success)throw new Error(result.error.issues.map(issue=>issue.message).slice(0,3).join("；"));
      setPayload(result.data);
    } catch(error){setMessage(error instanceof Error?error.message:"文件格式无效");}
  }
  async function apply() {
    if(!payload)return;setBusy(true);setMessage("");
    try {const response=await fetch("/api/seo/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const result=await response.json();if(!response.ok)throw new Error(result.message??"导入失败");setMessage(`${result.duplicate?"该批已导入，未重复写入":"导入完成"} · ${result.imported} 条`);setPayload(null);
    } catch(error){setMessage(error instanceof Error?error.message:"导入失败");}finally{setBusy(false);}
  }
  return <main className="appShell"><section className="dailyPanel"><h1>采集数据导入</h1><p>仅接收已核对的来源文件，使用当前登录会话保存数据。</p><input type="file" aria-label="选择采集JSON文件" accept="application/json,.json" disabled={busy} onChange={event=>void load(event.target.files?.[0])}/>
    {payload?<div><p>网站：{payload.targetDomain} · 批次：{payload.requestId}</p><p>周报 {payload.traffic.length} 期 · 关键词 {payload.observations.length} 条 · 页面 {payload.pages.length} 条</p><button disabled={busy} onClick={()=>void apply()}>{busy?"正在导入…":"保存采集数据"}</button></div>:null}
    {message?<p role="status">{message}</p>:null}</section></main>;
}
