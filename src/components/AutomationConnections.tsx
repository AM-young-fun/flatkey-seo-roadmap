"use client";
import { useEffect, useState } from "react";
import { Switch } from "antd";
type State={trafficEnabled:boolean;sheetsEnabled:boolean;ga4Email:string|null;ga4VerifiedAt:string|null;workerSeenAt:string|null;workerPaired:boolean};
export function AutomationConnections() {
  const [data,setData]=useState<State|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[secret,setSecret]=useState("");
  async function read(){const response=await fetch("/api/automation",{cache:"no-store"});const result=await response.json();if(!response.ok)throw new Error(result.message);setData(result);}
  useEffect(()=>{void read().catch(()=>setMessage("连接状态读取失败"));},[]);
  async function act(body:object){setBusy(true);setMessage("");try{const response=await fetch("/api/automation",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw new Error(value.message);setMessage(value.message);if(value.secret)setSecret(value.secret);await read();window.dispatchEvent(new Event("seo-operations-updated"));}catch(error){setMessage(error instanceof Error?error.message:"保存失败");}finally{setBusy(false);}}
  return <div className="automationConnections">
    {message?<p role="status" className="cacheNotice">{message}</p>:null}
    <article><div className="automationConnectionHeading"><div><h3>GA4 周报</h3><p>{data?.ga4Email?`已连接 · ${data.ga4Email}`:"待授权 · Flatkey 属性 541304395"}</p></div><Switch aria-label="每周流量周报" checked={data?.trafficEnabled??true} disabled={busy||!data} onChange={enabled=>void act({action:"toggle",kind:"TRAFFIC",enabled})}/></div>
      <p>服务账号加入 GA4 属性的“查看者”，并开启 Google Analytics Data API。上传 JSON 凭据后自动验证并加密保存。</p>
      <div className="dataforseoActions"><label className="okrRefresh automationUpload">{busy?"验证中…":"上传服务账号 JSON"}<input type="file" accept="application/json,.json" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value="";if(file){if(file.size>20000){setMessage("凭据文件过大");return;}void file.text().then(value=>act({action:"connectGa4",credentials:JSON.parse(value)})).catch(()=>setMessage("JSON 文件无效"));}}}/></label><button className="okrRefresh" disabled={busy} onClick={()=>void act({action:"retry",kind:"TRAFFIC"})}>重试未完成周报</button></div>
    </article>
    <article><div className="automationConnectionHeading"><div><h3>三表采集器</h3><p>{data?.workerSeenAt?`最近连接 ${new Date(data.workerSeenAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}`:data?.workerPaired?"已配对，等待采集器连接":"待部署 · 项目常驻采集器"}</p></div><Switch aria-label="每日三表同步" checked={data?.sheetsEnabled??true} disabled={busy||!data} onChange={enabled=>void act({action:"toggle",kind:"SHEETS",enabled})}/></div>
      <p>在常驻主机运行项目的 source-sync-worker，使用该主机的 DWS 登录。电脑关闭或采集器离线时不会显示同步完成。</p>
      <div className="dataforseoActions"><button className="okrRefresh" disabled={busy} onClick={()=>void act({action:"rotateWorker"})}>{data?.workerPaired?"重置配对凭据":"生成配对凭据"}</button><button className="okrRefresh" disabled={busy} onClick={()=>void act({action:"retry",kind:"SHEETS"})}>重试未完成同步</button></div>
      {secret?<div className="automationPairing"><label>配对凭据（仅本次显示）<input type="password" readOnly value={secret} aria-label="采集器配对凭据"/></label><button type="button" className="okrRefresh" onClick={()=>void navigator.clipboard.writeText(secret).then(()=>setMessage("配对凭据已复制"))}>复制</button><button type="button" className="okrRefresh" onClick={()=>setSecret("")}>隐藏</button></div>:null}
      <details><summary>部署方式</summary><p>项目文件 scripts/source-sync-worker.mjs。配置文件存放在仓库外，权限设为 600，包含 baseUrl、token，可选 profile 和 dwsPath。</p><pre>{'{"baseUrl":"https://你的项目域名/","token":"配对凭据"}\n\nSOURCE_WORKER_CONFIG=/安全路径/worker.json npm run worker:sources'}</pre><p>使用 systemd 或同类进程管理器常驻运行；项目每分钟检查队列，到期执行，完成回传结果。完整示例见 docs/project-schedules.md。</p></details>
    </article>
  </div>;
}
