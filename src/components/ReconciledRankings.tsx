"use client";
import { useCallback, useEffect, useState } from "react";
import { Button, Table, Tabs } from "antd";
import type { RankingReconciliation } from "@/lib/ranking-reconciliation";
const names: Record<string,string> = { US: "美国", JP: "日本", ES: "西班牙", BR: "巴西", CN: "中国" };
const colors = ["#588bf5", "#8b7bdd", "#e6aa54", "#47b49a", "#ee7686"];
const date = (value: string | null) => value ? new Date(value).toLocaleDateString("zh-CN", { timeZone: "America/Los_Angeles" }) : "—";
function shares(counts: number[]) {
  const total = counts.reduce((a,b)=>a+b,0); if (!total) return counts.map(()=>0);
  const raw=counts.map(count=>count/total*1000), rounded=raw.map(Math.floor), order=raw.map((value,index)=>({index,fraction:value-rounded[index]})).sort((a,b)=>b.fraction-a.fraction);
  const remainder=1000-rounded.reduce((a,b)=>a+b,0);
  for(let i=0;i<remainder;i++) rounded[order[i].index]++;
  return rounded.map(value=>value/10);
}
export function ReconciledRankings({ site, region }: { site: string; region: string }) {
  const [data,setData]=useState<RankingReconciliation|null>(null),[error,setError]=useState<string|null>(null),[version,setVersion]=useState(0),[details,setDetails]=useState(false);
  const refresh=useCallback(()=>setVersion(value=>value+1),[]);
  useEffect(()=>{
    const controller=new AbortController();
    void fetch("/api/seo/ranked-keyword-coverage?reconciled=1",{cache:"no-store",signal:controller.signal}).then(async response=>{
      const result=await response.json();if(!response.ok)throw Error(result.message??"排名读取失败");if(!controller.signal.aborted){setData(result);setError(null);}
    }).catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:"排名读取失败");});
    return()=>controller.abort();
  },[version]);
  if (site!=="all" && site!=="flatkey.ai") return <section className="discoveryPanel"><h2>已有关键词排名</h2><p className="chartNote">当前合并结果为 Flatkey；该站尚未取得同口径排名发现数据，未计入总数。</p></section>;
  const ranked=data?.ranked.filter(row=>region==="all"||row.country===region)??[], total=ranked.length;
  const countries=data?.countries.filter(row=>region==="all"||row.country===region)??[], countryShares=shares(countries.map(row=>row.count));
  const bands=data?.bands.map(band=>({...band,count:ranked.filter(row=>row.rank>=band.min&&row.rank<=band.max).length}))??[], bandShares=shares(bands.map(row=>row.count));
  const unranked=data?.unrankedBuilt.filter(row=>region==="all"||row.country===region)??[];
  return <section className="discoveryPanel visualSerpOverview reconciledRankings" aria-label="已有排名关键词与页面汇总">
    <div className="panelHeader"><div><h2>全站已有关键词排名</h2><p className="serpScope">Flatkey · 非品牌词 · 实测与数据库发现去重{region!=="all"?` · ${names[region]}`:""}</p></div><Button onClick={refresh}>刷新已存结果</Button></div>
    {error?<p className="loadError" role="alert">{error}</p>:!data?<p className="muted">正在对应已有排名和已建页面…</p>:<>
      <div className="overviewVisualGrid">
        <article className="overviewVisualCard"><h3>已发现排名词总数</h3><strong style={{fontSize:48,lineHeight:1.5}}>{total.toLocaleString()}</strong><p className="chartNote">每个关键词只计一次</p><p className="chartNote">已建页：已查未检出 {unranked.filter(row=>row.captured).length.toLocaleString()} 词 · 待补查 {unranked.filter(row=>!row.captured).length.toLocaleString()} 词</p><Button onClick={()=>setDetails(value=>!value)}>{details?"收起关键词与页面":"查看关键词与页面"}</Button></article>
        <article className="overviewVisualCard"><h3>各国占比</h3><div className="countryBarChart">{countries.map((row,index)=><div className="countryBarRow" key={row.country}><div className="countryBarLabel"><strong>{names[row.country]}</strong><small>{row.count}词</small></div><div className="countryBarValue"><span className="countryBarTrack"><i style={{width:`${countryShares[index]}%`,background:colors[index]}}/></span><strong>{countryShares[index].toFixed(1)}%</strong></div></div>)}</div><p className="chartNote">按每词最佳有效排名国家归属</p></article>
        <article className="overviewVisualCard"><h3>排名区间占比</h3><div className="countryBarChart">{bands.map((row,index)=><div className="countryBarRow" key={row.label}><div className="countryBarLabel"><strong>{row.label}</strong><small>{row.count}词</small></div><div className="countryBarValue"><span className="countryBarTrack"><i style={{width:`${bandShares[index]}%`,background:colors[index]}}/></span><strong>{bandShares[index].toFixed(1)}%</strong></div></div>)}</div><p className="chartNote">按每词最佳名次归属</p></article>
      </div>
      <p className="chartNote">数据库名次保留原索引日期，不冒充实时实测；完整来源与缺口见明细。{!data.coverage.discoverySavedComplete?"域名发现数据尚未齐全，当前为已取得范围。":""}{data.quote.newQueryCount?`待补查中，${data.quote.newQueryCount} 词已列付费待审清单，${data.quote.heldCount} 项先核对国家、语种或关联；未执行新抓取。`:"本次未发起付费抓取。"}</p>
      {details?<Tabs items={[
        {key:"ranked",label:`有排名的关键词 ${ranked.length}`,children:<Table size="small" rowKey="key" dataSource={ranked} pagination={{defaultPageSize:10,showSizeChanger:true}} scroll={{x:1000}} columns={[
          {title:"国家 / 关键词",key:"keyword",render:(_,row)=><><small>{names[row.country]}</small><div>{row.keyword}</div></>},
          {title:"排名",dataIndex:"rank",width:80,render:value=><strong>#{value}</strong>},
          {title:"实际排名页面 / 各页名次",key:"page",render:(_,row)=>row.pages.map(page=><div key={`${page.country}:${page.url}:${page.checkedAt}:${page.source}`}><a href={page.url} target="_blank" rel="noreferrer">{page.url}</a><strong> #{page.rank}</strong><small> · {names[page.country]}</small></div>)},
          {title:"已建承接页面",key:"expected",render:(_,row)=>row.expectedPages.length?row.expectedPages.map(url=><div key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></div>):"暂无已核对关联"},
          {title:"来源 / 日期（洛杉矶）",key:"date",width:180,render:(_,row)=><>{row.source==="serp"?"实测":"数据库索引"}<div>{date(row.checkedAt)}</div></>},
        ]}/>},
        {key:"unranked",label:`已建页未检出 / 待查 ${unranked.length}`,children:<Table size="small" rowKey={row=>`${row.country}:${row.keyword}`} dataSource={unranked} pagination={{defaultPageSize:10,showSizeChanger:true}} scroll={{x:1000}} columns={[
          {title:"国家 / 目标词",key:"word",render:(_,row)=><>{names[row.country]}<div>{row.keyword}</div></>},
          {title:"已建设页面",key:"pages",render:(_,row)=>row.pages.map(page=><div key={page.url}><a href={page.url} target="_blank" rel="noreferrer">{page.url}</a></div>)},
          {title:"已有结果",key:"result",render:(_,row)=><>{row.reason}<div>{date(row.checkedAt)}</div></>},
        ]}/>},
      ]}/>:null}
    </>}
  </section>;
}
