import type { WeeklyKeywordComparison } from "./weekly-keyword-comparison";

type TrafficWeek = { newUsers: number; newRegistrations: number };
export type DiagnosisTraffic = { current: TrafficWeek | null; previous: TrafficWeek | null; comparable: boolean; currentSites: string[]; previousSites: string[];
  siteTraffic: { siteDomain: string; current: TrafficWeek | null; previous: TrafficWeek | null }[] };
export type ReportFinding = { title: string; evidence: string; action: string; level: "issue" | "finding" | "unresolved"; url?: string; checkedAt?: string };
export type WeeklyReportDiagnosis = { significant: boolean; findings: ReportFinding[] };
type PageCheck = { url: string; checkedAt: string; findings: ReportFinding[] };
const DOMAINS = ["flatkey.ai", "rackrate.org", "modelfit.cc"];
const significant = (current: number, previous: number, absolute: number, minimum: number) => Math.abs(current - previous) >= absolute ||
  Math.abs(current - previous) >= minimum && (previous === 0 || Math.abs(current - previous) / previous >= .3);
function allowedPage(value: string, owner?: string): URL | null {
  try { const url = new URL(value), domain = DOMAINS.find(domain => url.hostname === domain || url.hostname === `www.${domain}`);
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") && domain && (!owner || owner === domain) ? url : null;
  } catch { return null; }
}
const attribute = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)?.slice(1).find(value => value !== undefined) ?? "";
async function limitedHtml(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder(); let html = "", size = 0;
  try { while (size < 262144) { const value = await reader.read(); if (value.done) break; const remaining = 262144 - size;
    html += decoder.decode(value.value.subarray(0, remaining), { stream: true }); size += value.value.length; } return html + decoder.decode();
  } finally { await reader.cancel(); }
}
export async function checkWeeklyReportPage(value: string, options: { fetch?: typeof fetch; now?: Date } = {}): Promise<PageCheck> {
  const checkedAt = (options.now ?? new Date()).toISOString(), original = allowedPage(value);
  const result: PageCheck = { url: value, checkedAt, findings: [] };
  if (!original) {
    result.findings.push({ title: "页面地址未检查", evidence: "该地址不属于可检查的本站 HTTPS 页面。", action: "核对原报告中的页面地址。", level: "unresolved", checkedAt });
    return result;
  }
  const owner = DOMAINS.find(domain => original.hostname === domain || original.hostname === `www.${domain}`)!;
  const fetcher = options.fetch ?? fetch, signal = AbortSignal.timeout(6000);
  let url = original;
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await fetcher(url.href, { redirect: "manual", signal, cache: "no-store", headers: { Accept: "text/html", "User-Agent": "Flatkey-SEO-Report/1.0" } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location"); await response.body?.cancel();
        const next = location ? allowedPage(new URL(location, url).href, owner) : null;
        if (!next || redirects === 3) { result.findings.push({ title: "页面跳转异常", evidence: "跳转超出本站范围、目标缺失或连续跳转过多。", action: "检查近期 URL 迁移和重定向规则。", level: "issue", url: value, checkedAt }); return result; }
        url = next; continue;
      }
      if (response.status >= 400) {
        await response.body?.cancel();
        result.findings.push({ title: `页面返回 HTTP ${response.status}`, evidence: `本次检查无法正常访问页面。`, action: response.status === 404 || response.status === 410 ? "恢复页面，或将旧地址正确跳转到对应的新页面。" : "检查服务器、CDN 或访问拦截规则。", level: "issue", url: value, checkedAt }); return result;
      }
      if (url.pathname === "/" && original.pathname !== "/") result.findings.push({ title: "旧页面跳回首页", evidence: `页面现跳转至 ${url.href}。`, action: "将旧地址关联到同意图的新页面，避免统一跳回首页。", level: "issue", url: value, checkedAt });
      const html = (await limitedHtml(response)).replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
      const noindex = /(?:^|[\s,:])(?:noindex|none)(?:$|[\s,;])/i.test(response.headers.get("x-robots-tag") ?? "") ||
        (html.match(/<meta\b[^>]*>/gi) ?? []).some(tag => /^(robots|googlebot)$/i.test(attribute(tag, "name")) && /(?:^|[\s,])(?:noindex|none)(?:$|[\s,;])/i.test(attribute(tag, "content")));
      if (noindex) result.findings.push({ title: "页面禁止搜索收录", evidence: "当前页面含 noindex / none 指令。", action: "若页面应参与排名，移除该指令并重新提交收录。", level: "issue", url: value, checkedAt });
      const canonicalTag = (html.match(/<link\b[^>]*>/gi) ?? []).find(tag => attribute(tag, "rel").split(/\s+/).includes("canonical"));
      if (canonicalTag) {
        const target = new URL(attribute(canonicalTag, "href"), url);
        const normalize = (input: URL) => `${input.hostname.replace(/^www\./, "")}${input.pathname.replace(/\/$/, "")}${input.search}`;
        if (normalize(target) !== normalize(url)) result.findings.push({ title: "canonical 指向其他页面", evidence: `当前规范地址为 ${target.href}。`, action: "核对是否有意合并页面，检查近期 canonical 变更。", level: "finding", url: value, checkedAt });
      }
      return result;
    }
  } catch {
    result.findings.push({ title: "页面检查未完成", evidence: "请求超时或连接受限，未据此认定 Google 无法访问。", action: "检查站点可用性与 Google 抓取日志。", level: "unresolved", url: value, checkedAt });
  }
  return result;
}
const checks = new Map<string, { expires: number; value: Promise<PageCheck> }>();
function cachedPageCheck(url: string) {
  const saved = checks.get(url);
  if (saved && saved.expires > Date.now()) return saved.value;
  const value = checkWeeklyReportPage(url); checks.set(url, { expires: Date.now() + 6 * 3600000, value });
  if (checks.size > 128) checks.delete(checks.keys().next().value!);
  return value;
}
export async function diagnoseWeeklyReport(traffic: DiagnosisTraffic, ranks: WeeklyKeywordComparison | null, periodEnd: string,
  options: { checkPage?: (url: string) => Promise<PageCheck>; now?: Date } = {}): Promise<WeeklyReportDiagnosis> {
  const trafficLarge = Boolean(traffic.comparable && traffic.current && traffic.previous &&
    (significant(traffic.current.newUsers, traffic.previous.newUsers, 500, 20) || significant(traffic.current.newRegistrations, traffic.previous.newRegistrations, 50, 5)));
  const ranksLarge = Boolean(ranks && (significant(ranks.current, ranks.previous, 50, 10) || ranks.entered + ranks.removed >= 20 ||
    ranks.buckets.some(row => significant(row.current, row.previous, 30, 10)) ||
    ranks.pageLosses.some(page => page.lost >= 5 || page.declined >= 10) || ranks.pageGains.some(page => page.gained + page.improved >= 10)));
  const result: WeeklyReportDiagnosis = { significant: trafficLarge || ranksLarge, findings: [] };
  if (!result.significant) return result;
  if (trafficLarge) {
    const sites = traffic.siteTraffic.filter(site => site.current && site.previous).map(site => ({ site: site.siteDomain, users: site.current!.newUsers - site.previous!.newUsers, registrations: site.current!.newRegistrations - site.previous!.newRegistrations }))
      .sort((a, b) => Math.abs(b.users) - Math.abs(a.users));
    result.findings.push({ title: "流量变化集中位置", evidence: sites.map(site => `${site.site}：新用户 ${site.users > 0 ? "+" : ""}${site.users}，注册 ${site.registrations > 0 ? "+" : ""}${site.registrations}`).join("；"),
      action: "按变化最大的站点检查 GA4 自然搜索、付费、推荐与直接访问渠道，并对照近期投放和埋点变更。现有全渠道汇总不足以认定流量波动由 SEO 导致。", level: "finding" });
  }
  if (ranksLarge && ranks) {
    if (ranks.comparedMarkets < 12) result.findings.push({ title: "历史数据覆盖不完整", evidence: `两期只有 ${ranks.comparedMarkets}/12 个网站与国家组合可比；缺失范围未按零排名计算。`, action: "补齐缺失的同期原始报告后再确认整体变化。", level: "unresolved" });
    const losses = ranks.pageLosses.slice(0, 3), gains = ranks.pageGains.slice(0, 3);
    for (const page of losses) result.findings.push({ title: "排名下降集中页面", evidence: `流失 ${page.lost} 词、下降 ${page.declined} 词；${page.reasons.join("、")}；相关词：${page.keywords.slice(0, 3).join("、")}。`, action: "对照该页近期发布、内容、内链和 URL 变更记录。", level: "finding", url: page.url });
    for (const page of gains) result.findings.push({ title: "排名提升集中页面", evidence: `新增页面排名 ${page.gained} 词、名次上升 ${page.improved} 词；相关词：${page.keywords.slice(0, 3).join("、")}。`, action: "对照页面上线和内容优化时间，确认可复用的改动。", level: "finding", url: page.url });
    const recent = Date.parse((options.now ?? new Date()).toISOString()) - Date.parse(`${periodEnd}T00:00:00Z`) <= 30 * 86400000;
    if (recent && losses.length) {
      const pages = await Promise.all(losses.map(page => (options.checkPage ?? cachedPageCheck)(page.url)));
      result.findings.push(...pages.flatMap(page => page.findings));
      if (!pages.some(page => page.findings.length)) result.findings.push({ title: "暂未发现页面访问或收录指令异常", evidence: `已检查 ${pages.length} 个主要流失页面的访问、跳转、noindex 和 canonical。当前检查不能证明历史时点的状态。`, action: "继续对照 Google 收录与抓取记录、同期内容改动及竞争页面变化，尚不能确认具体原因。", level: "unresolved", checkedAt: (options.now ?? new Date()).toISOString() });
    } else if (ranks.removed && !losses.length) result.findings.push({ title: "缺少页面归因证据", evidence: "关键词减少，但原始报告未提供可比的页面明细。", action: "补齐同期关键词与 URL 排名记录，再定位受影响页面。", level: "unresolved" });
  }
  return result;
}
