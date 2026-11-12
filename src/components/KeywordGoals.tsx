"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PageHeader } from "./PageHeader";
import { UiSelect } from "./UiSelect";
import { useSeoRead } from "./useSeoAnalytics";
import { useSeoCountry } from "./useSeoCountry";
import { keywordGoalTask, keywordGoalTaskHref, matchingKeywordGoal, type KeywordGoalInput } from "@/lib/keyword-goals";
import { WORKFLOW_MARKETS, WORKFLOW_SITES, WORKFLOW_LANGUAGE_LABELS, workflowContentLanguage, workflowContentLanguages, type WorkflowLanguage, type WorkflowSnapshot, type WorkflowTask } from "@/lib/seo-workflow";
import workspace from "./SeoWorkspace.module.css";
import styles from "./SeoWorkWorkspace.module.css";

const marketLabels = { US: "美国", JP: "日本", BR: "巴西", ES: "西班牙" };
export function KeywordGoals() {
  const history = useSeoRead<WorkflowSnapshot>("/api/seo/workflow?allHistory=true");
  const [country] = useSeoCountry();
  const [input, setInput] = useState<KeywordGoalInput>({ keyword: "", country: "US", siteDomain: "flatkey.ai", business: "GPU", pageUrl: "", owner: "我与 AI", dueDate: "", goal: "" });
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [saved, setSaved] = useState<WorkflowTask | null>(null);
  const attempt = useRef<{ identity: string; body: object } | null>(null);
  const change = <K extends keyof KeywordGoalInput>(key: K, value: KeywordGoalInput[K]) => { setInput(previous => ({ ...previous, [key]: value })); setSaved(null); setMessage(""); };
  useEffect(() => {
    const params = new URLSearchParams(location.search), market = params.get("country"), site = params.get("site");
    setInput(previous => ({ ...previous, keyword: params.get("keyword") ?? params.get("q") ?? "", pageUrl: params.get("targetUrl") ?? "",
      dueDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()),
      ...(market && market in WORKFLOW_MARKETS ? { country: market as KeywordGoalInput["country"] } : {}),
      ...(site && WORKFLOW_SITES.includes(site as KeywordGoalInput["siteDomain"]) ? { siteDomain: site as KeywordGoalInput["siteDomain"] } : {}) }));
  }, []);
  useEffect(() => { if (country !== "all") setInput(previous => ({ ...previous, country })); }, [country]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy || !history.data) return;
    setBusy(true); setMessage("");
    try {
      const candidate = keywordGoalTask(input, "goal-" + crypto.randomUUID());
      const existing = matchingKeywordGoal(history.data.tasks, candidate);
      if (existing) { setSaved(existing); setMessage("已有相同目标的任务，继续处理原任务即可。"); return; }
      const identity = JSON.stringify(input);
      if (attempt.current?.identity !== identity) attempt.current = { identity, body: { requestId: crypto.randomUUID(), action: "save_task", expectedVersion: 0, record: candidate } };
      const response = await fetch("/api/seo/workflow", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(attempt.current.body) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "目标未保存，请重试。");
      if (!body.stored || !["database", "local_preview"].includes(body.storage)) throw new Error("尚未取得保存回执，请刷新核对。");
      setSaved(body.record); setMessage("已加入工作任务，等待研究与执行。"); history.retry();
    } catch (error) { setMessage(error instanceof Error && error.name === "ZodError" ? "请核对国家对应语言、站点页面地址和必填项。" : error instanceof Error ? error.message : "目标未保存。"); }
    finally { setBusy(false); }
  }
  const language = workflowContentLanguage(input.siteDomain, input.country, input.language);
  return <main className={workspace.shell}>
    <PageHeader active="opportunities" />
    <div className={workspace.titleRow}><h1 className={workspace.title}>新建关键词目标</h1><Link className={styles.secondary} href="/opportunities">返回关键词列表</Link></div>
    <p className={workspace.description}>填写目标后加入工作任务。有目标页面则优化现有页面，没有则搭建关键词页面。</p>
    <form className={styles.goalForm} onSubmit={event => void save(event)}>
      <div className={styles.formGrid}>
        <label>站点<UiSelect aria-label="目标站点" value={input.siteDomain} onChange={value => change("siteDomain", value as KeywordGoalInput["siteDomain"])} options={WORKFLOW_SITES.map(value => ({ value, label: value }))} /></label>
        <label>目标国家<UiSelect aria-label="目标国家" value={input.country} onChange={value => change("country", value as KeywordGoalInput["country"])} options={Object.entries(marketLabels).map(([value, label]) => ({ value, label }))} /></label>
        <label>内容语言<UiSelect aria-label="内容语言" value={language} onChange={value => change("language", value as WorkflowLanguage)} options={workflowContentLanguages(input.siteDomain, input.country).map(value => ({ value, label: WORKFLOW_LANGUAGE_LABELS[value] }))} /></label>
        <label className={styles.spanAll}>关键词<input required maxLength={300} value={input.keyword} onChange={event => change("keyword", event.target.value)} placeholder={`输入${WORKFLOW_LANGUAGE_LABELS[language]}关键词`} /></label>
        <label className={styles.spanAll}>目标页面（没有则留空）<input type="url" value={input.pageUrl} onChange={event => change("pageUrl", event.target.value)} placeholder="https://flatkey.ai/…" /></label>
        <label>业务<UiSelect aria-label="关键词业务" value={input.siteDomain === "flatkey.ai" ? input.business : "CLUSTER"} onChange={value => change("business", value as KeywordGoalInput["business"])} options={input.siteDomain === "flatkey.ai" ? [{ value: "GPU", label: "GPU" }, { value: "API", label: "API" }] : [{ value: "CLUSTER", label: "集群" }]} /></label>
        <label>希望完成日期<input type="date" required value={input.dueDate} onChange={event => change("dueDate", event.target.value)} /></label>
        <label>负责人<input required maxLength={200} value={input.owner} onChange={event => change("owner", event.target.value)} /></label>
        <label className={styles.spanAll}>目标与要求（可选）<textarea rows={3} maxLength={1000} value={input.goal} onChange={event => change("goal", event.target.value)} /></label>
      </div>
      <p className={styles.muted}>将创建：{input.pageUrl.trim() ? "页面优化" : "关键词页面搭建"}</p>
      <div className={styles.goalActions}><button className={styles.primary} disabled={busy || !history.data} type="submit">{busy ? "保存中…" : "保存目标并加入工作任务"}</button>{saved ? <Link className={styles.secondary} href={keywordGoalTaskHref(saved)}>查看工作任务 →</Link> : null}</div>
      {message ? <p role="status">{message}</p> : null}
      {history.error ? <p role="alert">{history.error} <button className={styles.secondary} type="button" onClick={history.retry}>重新读取</button></p> : !history.data ? <p className={styles.muted}>正在核对已有任务…</p> : null}
    </form>
  </main>;
}
