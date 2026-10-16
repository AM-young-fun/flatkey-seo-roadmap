import { createHash } from "node:crypto";
import { normalizeKeywordText } from "./keyword-relevance";
import { normalizeAuditPageUrl, type KeywordWorkPlan, type PageAuditDomain } from "./page-audit";

export const PAGE_TASK_PLAN_ID = "flatkey-page-work-plans-2026-10-16-v1";
export type PageTaskWorkItem = KeywordWorkPlan & { keyword: string; keywordId: string };
export type PageTaskRow = {
  id: string; plannedUrl: string; type: string; status: string; title: string; reason: string;
  keywords: string[]; targetUrls: string[]; owner: string | null; dueAt: string | null;
};
export type PageTaskMergeSummary = {
  keywords: number; expandKeywords: number; buildKeywords: number; pageTasks: number;
  expandPages: number; buildPages: number; created: number; updated: number; reused: number;
  retired: number; retained: number; unchanged: number;
};
export type PageTaskMergeResult = {
  siteDomain: PageAuditDomain; action: "preview" | "apply"; status: "PREVIEW" | "APPLIED";
  stateHash: string; summary: PageTaskMergeSummary; conflicts: string[];
  tasks: Array<PageTaskRow & { workPlans: PageTaskWorkItem[]; disposition: "CREATE" | "UPDATE" | "UNCHANGED" }>;
};

// These destinations are editorial plans, never evidence that a page exists.
// The local-coding guide intentionally reuses the already planned broad guide;
// exact model comparisons retain separate destinations and are not collapsed.
const buildDestinations: Record<string, string> = {
  "ai evaluation dashboard": "ai-evaluation-platforms-dashboards",
  "ai evaluation platform": "ai-evaluation-platforms-dashboards",
  "ai security audit": "ai-security-audit",
  "apify for web scraping": "apify-web-scraping-guide",
  "best coding agents": "best-coding-agents",
  "best local llms for coding 2026": "best-llms-for-coding",
  "datadog llm observability api": "datadog-llm-observability-api",
  "llm observability datadog": "datadog-llm-observability-api",
  "deepseek v4 vs gpt 5.4": "deepseek-v4-vs-gpt-5-4",
  "deepseek v4 vs gpt 5.5": "deepseek-v4-vs-gpt-5-5",
  "deepseek vs gpt 4": "deepseek-vs-gpt-4",
  "free ai image generator": "free-ai-image-generator",
  "gemini 2 api": "gemini-2-api",
  "grok 4.3 vs gpt 5.4": "grok-4-3-vs-gpt-5-4",
  "grok 4.3 vs gpt 5.5": "grok-4-3-vs-gpt-5-5",
  "grok code fast 1 vs gpt 5": "grok-code-fast-1-vs-gpt-5",
  "grok vs gpt 4": "grok-vs-gpt-4",
  "how to evaluate a machine learning model": "how-to-evaluate-machine-learning-model",
  "is claude better than chatgpt for math": "claude-vs-chatgpt-math",
  "kimi k3 local": "kimi-k3-local-deployment",
  "open ai gdpr": "openai-gdpr",
  "open router ai api key": "openrouter-api-keys",
  "open router api keys": "openrouter-api-keys",
  "openrouter ai api key": "openrouter-api-keys",
  "open router gemini": "openrouter-gemini-api",
  "pii redaction api": "pii-redaction-api",
  "prompt testing platform": "prompt-testing-platform",
  "sora api documentation": "sora-api-documentation-lifecycle",
  "vercel ai sdk components": "vercel-ai-sdk-components",
  "vercel ai sdk documentation": "vercel-ai-sdk-documentation",
  "vercel ai sdk pricing": "vercel-ai-sdk-pricing",
};

export function pageTaskDestination(item: PageTaskWorkItem): string | null {
  if (item.action === "LINK") return null;
  if (item.action === "EXPAND") return item.pageUrls[0] ? normalizeAuditPageUrl(item.pageUrls[0]) : null;
  if (item.plannedPageUrl) return normalizeAuditPageUrl(item.plannedPageUrl);
  const slug = buildDestinations[normalizeKeywordText(item.keyword)];
  return slug ? `https://flatkey.ai/blog/${slug}` : null;
}
export function pageTaskWorkDetails(task: Pick<PageTaskRow, "keywords">, items: PageTaskWorkItem[]) {
  const words = new Set(task.keywords.map(normalizeKeywordText));
  const workPlans = items.filter(item => item.action !== "LINK" && words.has(normalizeKeywordText(item.keyword)));
  return { workPlans, requirements: [...new Set(workPlans.flatMap(item => item.requirements))], acceptance: [...new Set(workPlans.flatMap(item => item.acceptance))] };
}

const stable = (row: PageTaskRow) => ({ ...row, keywords: [...row.keywords].sort(), targetUrls: [...row.targetUrls].sort() });
const same = (a: PageTaskRow, b: PageTaskRow) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const manual = (row: PageTaskRow) => row.status !== "TODO" || row.owner !== null || row.dueAt !== null;
const urlKey = (url: string) => { try { return normalizeAuditPageUrl(url); } catch { return url; } };
const uniqWords = (words: string[]) => [...new Map(words.map(word => [normalizeKeywordText(word), word])).values()].sort((a, b) => a.localeCompare(b));
function mergeManualFields(primary: PageTaskRow, others: PageTaskRow[]): PageTaskRow | null {
  const rows = [primary, ...others];
  const owners = [...new Set(rows.flatMap(row => row.owner === null ? [] : [row.owner]))];
  const dates = [...new Set(rows.flatMap(row => row.dueAt === null ? [] : [row.dueAt]))];
  const progress = [...new Set(rows.filter(row => row.status !== "TODO").map(row => row.status))];
  if (owners.length > 1 || dates.length > 1 || progress.length > 1) return null;
  const reasons = [...new Set([primary.reason, ...others.filter(row => row.reason !== primary.reason || row.title !== primary.title).map(row => `合并来源“${row.title}”：${row.reason}`)])];
  return { ...primary, owner: owners[0] ?? null, dueAt: dates[0] ?? null, status: progress[0] ?? "TODO", reason: reasons.join("\n\n") };
}

export function buildPageTaskMerge(before: PageTaskRow[], allItems: PageTaskWorkItem[], planId = PAGE_TASK_PLAN_ID) {
  const items = allItems.filter(item => item.action !== "LINK").sort((a, b) => normalizeKeywordText(a.keyword).localeCompare(normalizeKeywordText(b.keyword)));
  const pending = new Set(items.map(item => normalizeKeywordText(item.keyword)));
  const conflicts: string[] = [];
  if (pending.size !== items.length) conflicts.push("同一关键词有重复的优化清单，须先核对后再合并");
  const groups = new Map<string, PageTaskWorkItem[]>();
  for (const item of items) {
    const destination = pageTaskDestination(item);
    if (!destination) { conflicts.push(`关键词“${item.keyword}”尚无经过审核的建设页面规划`); continue; }
    const group = groups.get(destination) ?? [];
    group.push(item); groups.set(destination, group);
  }
  const active = before.filter(row => !["RESTORED", "MERGED"].includes(row.status));
  const originals = new Map(active.map(row => [row.id, row]));
  const after = new Map(active.map(row => [row.id, { ...row, keywords: row.keywords.filter(word => !pending.has(normalizeKeywordText(word))) }]));
  const claimed = new Set<string>();
  const planned: PageTaskMergeResult["tasks"] = [];
  for (const [destination, workPlans] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const action = workPlans[0].action;
    if (workPlans.some(item => item.action !== action)) { conflicts.push(`页面 ${destination} 同时被安排建设和补充内容，请先核对`); continue; }
    const samePage = active.filter(row => !claimed.has(row.id) && [row.plannedUrl, ...row.targetUrls].some(url => urlKey(url) === destination));
    // An emptied old task can be repurposed instead of leaving a duplicate
    // card after the reviewed destination changes. Partly unrelated tasks stay.
    const oldWords = new Set(workPlans.map(item => normalizeKeywordText(item.keyword)));
    const overlap = samePage.length ? [] : active.filter(row => !claimed.has(row.id) && after.get(row.id)?.keywords.length === 0 && row.keywords.some(word => oldWords.has(normalizeKeywordText(word))));
    const candidates = (samePage.length ? samePage : overlap).sort((a, b) => Number(manual(b)) - Number(manual(a)) || a.id.localeCompare(b.id));
    const old = candidates[0];
    const id = old?.id ?? `${planId}:page:${createHash("sha256").update(destination).digest("hex").slice(0, 20)}`;
    const base = old ? after.get(old.id)! : { id, plannedUrl: destination, type: action === "BUILD" ? "NEW" : "EXPAND", status: "TODO", title: workPlans[0].proposedTitle,
      reason: "按逐词页面核验合并到同一页面任务；各关键词的补充要求与验收标准分别保留。", keywords: [], targetUrls: [], owner: null, dueAt: null };
    const duplicateTasks = samePage.filter(row => row.id !== id);
    const mergedFields = mergeManualFields(base, duplicateTasks);
    if (!mergedFields) { conflicts.push(`页面 ${destination} 的多个旧任务已有不同负责人、期限或进度，请先核对`); continue; }
    const extraWords = duplicateTasks.flatMap(row => after.get(row.id)?.keywords ?? []);
    for (const duplicate of duplicateTasks) {
      claimed.add(duplicate.id);
      after.set(duplicate.id, { ...after.get(duplicate.id)!, keywords: [], status: "MERGED" });
    }
    const next: PageTaskRow = { ...mergedFields, plannedUrl: destination, type: action === "BUILD" ? "NEW" : "EXPAND",
      keywords: uniqWords([...base.keywords, ...extraWords, ...workPlans.map(item => item.keyword)]),
      // Supplementary verified pages stay in each word's workPlan. One primary
      // edit destination keeps the page task count independent of word count.
      targetUrls: action === "BUILD" ? [] : [destination] };
    after.set(id, next); claimed.add(id);
    planned.push({ ...next, workPlans, disposition: !old ? "CREATE" : same(old, next) ? "UNCHANGED" : "UPDATE" });
  }
  for (const row of active) {
    const next = after.get(row.id)!;
    if (!claimed.has(row.id) && row.keywords.length > 0 && next.keywords.length === 0) {
      // Retain assignment/progress rather than silently closing a manual task.
      if (manual(row)) conflicts.push(`旧任务“${row.title}”已有负责人或进度，且全部关键词将移至其他页面，请先核对`);
      else after.set(row.id, { ...next, status: "MERGED" });
    }
  }
  // Reconcile duplicate legacy page cards too, even when their words are not
  // part of this optimization batch. A task's first actual target is its
  // primary destination; alternative URLs remain attached as supporting pages.
  const primaryGroups = new Map<string, PageTaskRow[]>();
  for (const row of after.values()) {
    if (row.status === "MERGED") continue;
    const key = urlKey(row.targetUrls[0] ?? row.plannedUrl);
    const group = primaryGroups.get(key) ?? [];
    group.push(row); primaryGroups.set(key, group);
  }
  for (const [destination, group] of primaryGroups) {
    if (group.length < 2) continue;
    group.sort((a, b) => Number(claimed.has(b.id)) - Number(claimed.has(a.id)) || Number(manual(b)) - Number(manual(a)) || a.id.localeCompare(b.id));
    const [primary, ...duplicates] = group;
    const mergedFields = mergeManualFields(primary, duplicates);
    if (!mergedFields) { conflicts.push(`页面 ${destination} 的多个旧任务已有不同负责人、期限或进度，请先核对`); continue; }
    const merged = { ...mergedFields, plannedUrl: destination, keywords: uniqWords(group.flatMap(row => row.keywords)), targetUrls: [...new Set(group.flatMap(row => row.targetUrls).map(urlKey))] };
    after.set(primary.id, merged);
    for (const duplicate of duplicates) { after.set(duplicate.id, { ...duplicate, keywords: [], status: "MERGED" }); claimed.add(duplicate.id); }
    const entry = planned.find(row => row.id === primary.id);
    if (entry) Object.assign(entry, merged, { disposition: originals.has(primary.id) ? same(originals.get(primary.id)!, merged) ? "UNCHANGED" : "UPDATE" : "CREATE" });
  }
  const rows = [...after.values()];
  for (const word of pending) {
    const count = rows.filter(row => row.status !== "MERGED" && row.keywords.some(text => normalizeKeywordText(text) === word)).length;
    if (count !== 1) conflicts.push(`关键词“${word}”应只对应一个主要页面任务，当前为 ${count} 个`);
  }
  const changes = rows.filter(row => !originals.has(row.id) || !same(originals.get(row.id)!, row));
  const stateHash = createHash("sha256").update(JSON.stringify({ version: PAGE_TASK_PLAN_ID, before: [...before].sort((a, b) => a.id.localeCompare(b.id)).map(stable), items })).digest("hex");
  const summary: PageTaskMergeSummary = { keywords: pending.size, expandKeywords: items.filter(item => item.action === "EXPAND").length,
    buildKeywords: items.filter(item => item.action === "BUILD").length, pageTasks: planned.length,
    expandPages: planned.filter(row => row.type === "EXPAND").length, buildPages: planned.filter(row => row.type === "NEW").length,
    created: planned.filter(row => row.disposition === "CREATE").length, updated: changes.filter(row => originals.has(row.id) && row.status !== "MERGED").length,
    reused: planned.filter(row => originals.has(row.id)).length, retired: changes.filter(row => row.status === "MERGED").length,
    retained: rows.filter(row => !claimed.has(row.id) && row.status !== "MERGED").length, unchanged: rows.length - changes.length };
  return { stateHash, summary, conflicts: [...new Set(conflicts)], tasks: planned, changes, after: rows };
}
