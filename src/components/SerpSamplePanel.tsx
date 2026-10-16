"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { SerpSamplePreview, SerpSampleResult } from "@/lib/serp-sample";
import type { SerpMonitorRunDto } from "@/lib/serp-monitor-types";
import type { SerpResultsResponse, SerpKeywordResult } from "@/lib/serp-results";
import { dashboardStore } from "@/lib/dashboard-client";

const money = (micros: number) => `$${(micros / 1_000_000).toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
const markets = [{ code: "US", label: "美国" }, { code: "JP", label: "日本" }, { code: "ES", label: "西班牙" }, { code: "BR", label: "巴西" }] as const;
const states: Record<string, string> = { PLANNED: "准备提交", RUNNING: "等待结果", COMPLETED: "已完成", PARTIAL: "已结束，部分结果待核验", FAILED: "失败", UNKNOWN: "提交结果待核对" };
const resultLabel = (item?: SerpKeywordResult) => !item ? "待返回" : item.rank != null ? `#${item.rank}` : ({ PENDING: "待采集", QUEUED: "等待结果", OUTSIDE_TOP100: "前100外", INCOMPLETE: "待核验", FAILED: "失败", RANKED: "—" }[item.status]);

export function SerpSamplePanel({ latestRun, onChanged }: { latestRun: SerpMonitorRunDto | null; onChanged: () => Promise<void> }) {
  const [preview, setPreview] = useState<SerpSamplePreview | null>(null);
  const [run, setRun] = useState<SerpMonitorRunDto | null>(latestRun);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [balance, setBalance] = useState<{balanceMicros: number; checkedAt: string} | null>(null);
  const [results, setResults] = useState<Record<string, SerpResultsResponse>>({});
  useEffect(() => { if (latestRun) setRun(latestRun); }, [latestRun]);
  const readResults = useCallback(async () => {
    const loaded = await Promise.all(markets.map(async market => {
      const response = await fetch(`/api/serp-monitor/results?site=all&region=${market.code}`, { cache: "no-store" });
      if (!response.ok) throw new Error("实测结果读取失败，请刷新结果");
      return [market.code, await response.json() as SerpResultsResponse] as const;
    }));
    setResults(Object.fromEntries(loaded));
  }, []);
  useEffect(() => { if (run) void readResults().catch(() => {}); }, [run, readResults]);
  async function post(body: unknown) {
    const response = await fetch("/api/serp-monitor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) window.location.assign("/login");
    if (!response.ok) throw new Error(result.message ?? "状态未确认，请查看原记录，不要重复提交");
    return result;
  }
  async function prepare() {
    setBusy("preview"); setError("");
    try { const value = await post({ action: "previewSample" }) as SerpSamplePreview; setPreview(value); if (value.existingRun) setRun(value.existingRun); }
    catch (error) { setError(error instanceof Error ? error.message : "无法确认余额"); }
    finally { setBusy(""); }
  }
  async function readBalance() {
    setBusy("balance"); setError("");
    try { setBalance(await post({ action: "sampleBalance" })); }
    catch (error) { setError(error instanceof Error ? error.message : "余额核实失败"); }
    finally { setBusy(""); }
  }
  async function start() {
    if (!preview || run || attempted) return;
    setAttempted(true); setBusy("start"); setError("");
    try {
      const value = await post({ action: "startSample", idempotencyKey: `sample-${crypto.randomUUID()}`, expectedSubsetHash: preview.subsetHash, authorizationToken: preview.authorizationToken, maxBudgetMicros: preview.maxBudgetMicros }) as SerpSampleResult;
      setRun(value.run);
      dashboardStore.clear(); window.dispatchEvent(new Event("seo-rankings-updated")); await onChanged();
    } catch (error) { setError(error instanceof Error ? error.message : "提交结果未确认，请刷新原记录"); await onChanged().catch(() => {}); }
    finally { setBusy(""); }
  }
  const collect = useCallback(async () => {
    if (!run) return;
    setBusy("collect"); setError("");
    try {
      const value = await post({ action: "resume", runId: run.id }) as { run: SerpMonitorRunDto };
      setRun(value.run); await readResults();
      dashboardStore.clear(); window.dispatchEvent(new Event("seo-rankings-updated")); await onChanged();
    } catch (error) { setError(error instanceof Error ? error.message : "读取结果失败"); }
    finally { setBusy(""); }
  }, [run, readResults, onChanged]);
  useEffect(() => {
    if (!run || !["PLANNED", "RUNNING"].includes(run.status) || busy || error) return;
    const timer = window.setTimeout(() => void collect(), 45000);
    return () => window.clearTimeout(timer);
  }, [run, busy, error, collect]);
  const rows = new Map<string, { keyword: string; byMarket: Record<string, SerpKeywordResult> }>();
  for (const market of markets) for (const item of results[market.code]?.items ?? []) {
    if (item.runId !== run?.id) continue;
    const key = `${item.siteDomain}:${item.keywordId}`, row = rows.get(key) ?? { keyword: item.keyword, byMarket: {} };
    row.byMarket[market.code] = item; rows.set(key, row);
  }
  function exportCsv() {
    const cell = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const lines = [["关键词", "国家", "状态", "最佳自然名次", "实际排名页面及各自名次", "实测时间"], ...[...rows.values()].flatMap(row => markets.map(market => {
      const item = row.byMarket[market.code]; return [row.keyword, market.label, resultLabel(item), item?.rank?.toString() ?? "", item?.pages.map(page => `#${page.rankGroup} ${page.url}`).join(" ; ") ?? "", item?.checkedAt ?? ""];
    }))];
    const url = URL.createObjectURL(new Blob(["\uFEFF", lines.map(line => line.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "flatkey-four-market-sample.csv"; link.click(); URL.revokeObjectURL(url);
  }
  return <section className="serpSamplePanel" aria-label="品牌与模型价格小批验证">
    <h3>本次小批验证</h3><p className="chartNote">品牌词和模型价格词 · 美国、日本、西班牙、巴西 · 仅执行这一批，全量定时保持关闭。</p>
    {error ? <p role="alert" className="loadError">{error}</p> : null}
    {!run ? <button className="okrRefresh" disabled={Boolean(busy) || attempted} onClick={() => void prepare()}>{busy === "preview" ? "正在核实余额…" : "核实余额与测试名单"}</button> : null}
    {preview ? <div className="dataforseoPreview"><p>{run ? "提交前余额" : "账户实时余额"} <strong>{money(preview.liveBalanceMicros)}</strong> · 本次 {preview.targets.length} 词 / {preview.quote.queryCount} 次查询 · 最高 <strong>{money(preview.maxBudgetMicros)}</strong></p><p className="chartNote">提交前再次核对余额，并预留 {money(preview.safetyMarginMicros)}。只在已保存的这一批任务中取回结果，不重复付费。</p><details><summary>查看测试词</summary><p>{preview.targets.map(target => target.keyword).join("、")}</p></details>{!run ? <button className="managePrimary" disabled={Boolean(busy) || attempted || Date.parse(preview.expiresAt) <= Date.now()} onClick={() => void start()}>{busy === "start" ? "正在提交这一批…" : attempted ? "已提交，请核对原记录" : `抓取这一批（最高 ${money(preview.maxBudgetMicros)}）`}</button> : null}</div> : null}
    {run ? <><p><strong>{states[run.status] ?? run.status}</strong> · {run.targetCount} 词 / {run.queryCount} 次查询 · {run.status === "RUNNING" || run.status === "PLANNED" ? "结算中" : "回执费用"} {run.actualCostMicros == null ? "待确认" : money(run.actualCostMicros)}</p><p className="chartNote">已返回 {(run.taskCounts.COMPLETE ?? 0) + (run.taskCounts.INCOMPLETE ?? 0)} / {run.queryCount} · 等待 {run.taskCounts.QUEUED ?? 0} · 失败 {run.taskCounts.FAILED ?? 0}</p><div className="dataforseoActions"><button className="okrRefresh" disabled={Boolean(busy)} onClick={() => void collect()}>{busy === "collect" ? "正在获取结果…" : "获取已提交结果（不再次计费）"}</button><button className="okrRefresh" disabled={Boolean(busy)} onClick={() => void readBalance()}>{busy === "balance" ? "正在核实余额…" : "刷新账户余额"}</button><Link className="textLink" href="/keywords?sample=1">查看本次关键词与页面 →</Link>{rows.size ? <button className="okrRefresh" onClick={exportCsv}>下载四国测试结果</button> : null}</div>{balance ? <p className="chartNote">账户余额 {money(balance.balanceMicros)} · {new Date(balance.checkedAt).toLocaleString("zh-CN", {timeZone:"Asia/Shanghai"})} 核实；供应商结算退差额后可能增加。</p> : null}{rows.size ? <details className="simpleExplanation" open><summary>四国实测对比（{rows.size} 词）</summary><div className="serpPeriodTable"><table><thead><tr><th>关键词</th>{markets.map(market => <th key={market.code}>{market.label}</th>)}</tr></thead><tbody>{[...rows.entries()].map(([key, row]) => <tr key={key}><td>{row.keyword}</td>{markets.map(market => { const item = row.byMarket[market.code]; return <td key={market.code}>{item?.url ? <a href={item.url} target="_blank" rel="noreferrer">{resultLabel(item)} ↗</a> : resultLabel(item)}</td>; })}</tr>)}</tbody></table></div><p className="chartNote">名次已匹配实际页面；未取满100条且未命中的记录保留为“待核验”，不算作“前100外”。</p></details> : null}</> : null}
  </section>;
}
