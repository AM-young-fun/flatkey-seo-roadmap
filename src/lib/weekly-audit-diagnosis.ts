import type { WeeklyTrafficEvidence } from "./weekly-traffic-evidence";
import type { WeeklyReportDiagnosis } from "./weekly-report-diagnosis";

export function auditedWeeklyDiagnosis(data: WeeklyTrafficEvidence): WeeklyReportDiagnosis {
  if (!data.complete) return { significant: false, findings: [] };
  const organic = data.channels.find(row => row.name === "Organic Search");
  const result: WeeklyReportDiagnosis = { significant: false, findings: [] };
  if (organic) result.findings.push({ title: "自然搜索获客与注册变化", level: "finding",
    evidence: `首次来源为自然搜索的新用户 ${organic.newUsers.previous} → ${organic.newUsers.current}，该来源用户当期注册人数 ${organic.registrations.previous} → ${organic.registrations.current}。注册人数按已核验的注册成功事件用户去重，包含当期注册的老访客。`,
    action: "核对自然搜索的落地页、地区、设备和注册路径变化。首次来源不代表注册时的会话来源，注册人数 / 新用户数不等于同一批新访客的转化率。" });
  if (organic && data.trafficScope === "organic_search" && data.channels.every(row => row.name === "Organic Search") && data.newVisitorFunnel && data.formFunnel) {
    const before = data.newVisitorFunnel.previous, after = data.newVisitorFunnel.current;
    const formBefore = data.formFunnel.previous, formAfter = data.formFunnel.current;
    const rate = (rows: typeof before) => rows[0].users ? `${(rows.at(-1)!.users / rows[0].users * 100).toFixed(2)}%` : "—";
    result.findings.push({ title: "自然搜索新访客与表单顺序漏斗变化", level: "finding",
      evidence: `首次来源为自然搜索的访客，首次访问后注册 ${before.at(-1)!.users}/${before[0].users}（${rate(before)}）→ ${after.at(-1)!.users}/${after[0].users}（${rate(after)}）；按首次访问→开始填表→提交→注册的完整路径，成功 ${formBefore.at(-1)!.users} → ${formAfter.at(-1)!.users}。`,
      action: "分别核对首次访问后进入表单、提交表单及注册完成的流失率。表单事件可能包含其他表单，也不覆盖所有登录方式，不能据此宣称整个注册系统无故障。" });
  }
  if (data.search) result.findings.push({ title: data.search.clicks.current<data.search.clicks.previous ? "Google 自然搜索点击下降" : "Google 自然搜索点击未下降", level: "finding",
    evidence: `GSC 全站点击 ${data.search.clicks.previous} → ${data.search.clicks.current}，曝光 ${data.search.impressions.previous} → ${data.search.impressions.current}。这是 Google 自然搜索的辅助获客证据，不是关键词实测排名，也不能证明注册变化的原因。`,
    action: "对照同期自然搜索落地页和关键词排名。GA4 首次来源用户与 GSC 点击口径不同，不能直接相减或用点击变化替代排名变化。" });
  result.significant = result.findings.length > 0;
  return result;
}
