export type ReportTechnicalSummary = {
  status: "issues" | "clear" | "incomplete";
  issues: string[];
  message: "暂无问题" | "检查未完成" | null;
  incomplete: boolean;
};

const markdownLink = /\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g;
const plainText = (value: string) => value.replace(markdownLink, "$1").replace(/\*\*|`/g, "").trim();
const cleanLine = (value: string) => value.replace(/^\s*(?:[-*•]\s+|\d+[.、]\s*)/, "").replace(/\*\*/g, "").trim();
const observationOnly = /^(?:关键词排名|关键词实测|排名观察|来源日期|巡检时间|下一步|覆盖范围|结论限定|统计口径|域名索引总览)/;
const resolved = /(?:已修复|已解决|已恢复|已消除|误报|并非(?:问题|异常)|不构成(?:问题|异常))/;
const noIssues = /(?:暂无(?:已记录的)?(?:巡检)?问题|未(?:发现|见)(?:新增|明显|技术)?(?:问题|异常)|没有(?:发现)?(?:问题|异常)|无新增(?:问题|异常))/;
const passed = /(?:全部|均)(?:已)?通过|(?:检查|巡检)(?:结果)?正常|(?:未发现|没有|无)(?:[^，。；]{0,36})(?:[45]\d\d|死链|断链|noindex|canonical|重定向|孤立页)|[45]\d\d[^，。；]{0,20}检查通过/i;
const issueSignals = /(?:(?<!\d)[45]\d\d(?!\d|\s*(?:项|个|条|次|毫秒|ms))|死链|断链|链接失效|页面打不开|无法访问|重定向(?:循环|过多|链)|孤立(?:页|页面)|(?:标题|描述|canonical|规范链接|hreflang)[^，。；]{0,32}(?:缺失|错误|不一致|重复)|noindex[^，。；]{0,32}(?:误|错误|阻止|导致)|robots[^，。；]{0,32}(?:阻止|错误|拦截)|未(?:被)?收录|未编入索引|加载(?:慢|超时)|LCP[^，。；]{0,20}(?:超标|差|慢)|移动[^，。；]{0,20}(?:溢出|错位|不可用)|缓存[^，。；]{0,20}(?:过期|旧版|未刷新)|(?:发现|存在|仍有|尚有|确认)[^，。；]{0,42}(?:问题|异常|错误|故障))/i;

function technicalClauses(raw: string) {
  const links: string[] = [];
  const protectedText = raw.replace(markdownLink, link => `\uE000${links.push(link) - 1}\uE001`);
  return protectedText.split(/[。；，]|(?:但(?:是)?|然而|不过)/).map(clause =>
    cleanLine(clause.replace(/\uE000(\d+)\uE001/g, (_, index) => links[Number(index)]))
  ).filter(Boolean);
}

/** Keep clickable issue evidence intact while bounding the text shown in the report. */
function shortIssue(value: string, length = 96) {
  const raw = cleanLine(value).replace(/^(?:技术检查|收录观察|技术质检|问题|异常|待修复)[：:]\s*/, "");
  const priorityLink = /^(P[0-4]\s+)\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/.exec(raw);
  if (priorityLink) return `${priorityLink[1]}[${priorityLink[2]}](${priorityLink[3]})`;
  const tokens = raw.split(/(\[[^\]]+\]\(https:\/\/[^\s)]+\))/);
  let remaining = length;
  let output = "";
  for (const token of tokens) {
    if (!token || remaining <= 0) continue;
    const link = /^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)$/.exec(token);
    const label = link?.[1] ?? token;
    const shortened = label.length > remaining ? label.slice(0, Math.max(0, remaining - 1)) + "…" : label;
    output += link ? `[${shortened}](${link[2]})` : shortened;
    remaining -= label.length;
  }
  return output.trim();
}

/** A display-only projection. The stored technical text and reviewed report remain unchanged. */
export function summarizeReportTechnical(input: string | readonly string[] | null | undefined): ReportTechnicalSummary {
  const lines = (typeof input === "string" ? input.split(/\r?\n/) : input ?? []).map(cleanLine).filter(Boolean);
  let completed = false;
  let incomplete = false;
  const issues: string[] = [];
  for (const raw of lines) {
    const line = plainText(raw);
    if (/^#{1,6}\s|^(?:SEO 技术质检|关键词、收录与技术观察)$/.test(line) || observationOnly.test(line)) continue;
    const technical = line.replace(/^(?:技术检查|技术质检|收录观察)[：:]\s*/, "");
    const counts = /已完成\s*(\d+)\s*[/／]\s*(\d+)\s*项检查/.exec(technical);
    if (counts) {
      if (Number(counts[2]) > 0 && Number(counts[1]) === Number(counts[2])) completed = true;
      else incomplete = true;
    }
    // A completed sample is still complete within its recorded scope. Scope caveats and
    // historical source dates do not turn it into an unfinished run.
    if (/^(?:已完成\s*·|本批\s*\d+\s*项检查完成|(?:本批|本次)?(?:技术)?检查(?:已)?完成)|完成\s*\d+\s*项检查/.test(technical)) completed = true;
    if (/^(?:部分完成|有阻塞|失败|进行中|待更新)|尚未收到巡检回执|(?:本期|技术|巡检|检查)[^。；]{0,20}(?:未完成|未执行|未进行|未取得回执|无回执)|^缺口\s*·/.test(technical)) incomplete = true;

    for (const clause of technicalClauses(raw)) {
      const text = plainText(clause).replace(/^(?:技术检查|技术质检|收录观察)[：:]\s*/, "");
      if (observationOnly.test(text)) continue;
      if (noIssues.test(text) || passed.test(text)) { completed = true; continue; }
      if (resolved.test(text)) continue;
      // These describe an unfinished check or collection, not a confirmed website defect.
      if (/^(?:缺口\s*·|复核\s*·|已完成|部分完成|有阻塞|失败|进行中)|(?:PSI|采集|检查|巡检)[^，。；]{0,30}(?:限流|429|未完成|失败|待更新|待补|无回执)/i.test(text)) continue;
      const explicitIssue = /^P[0-4]\s+|^(?:问题|异常|待修复)[：:]/.test(text);
      if (explicitIssue || issueSignals.test(text)) issues.push(shortIssue(clause));
    }
  }
  const unique = [...new Set(issues)];
  if (unique.length) return { status: "issues", issues: unique, message: null, incomplete };
  if (incomplete || !completed) return { status: "incomplete", issues: [], message: "检查未完成", incomplete: true };
  return { status: "clear", issues: [], message: "暂无问题", incomplete: false };
}
