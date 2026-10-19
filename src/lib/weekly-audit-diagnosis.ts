import type { WeeklyTrafficEvidence } from "./weekly-traffic-evidence";
import type { WeeklyReportDiagnosis } from "./weekly-report-diagnosis";

export function auditedWeeklyDiagnosis(data: WeeklyTrafficEvidence): WeeklyReportDiagnosis {
  if (!data.complete) return { significant: false, findings: [] };
  const direct = data.channels.find(row => row.name === "Direct"), paid = data.channels.find(row => row.name === "Paid Search");
  const result: WeeklyReportDiagnosis = { significant: true, findings: [] };
  if (direct && paid) result.findings.push({ title: "流量与注册的渠道变化", level: "finding",
    evidence: `直接访问新用户 ${direct.newUsers.previous} → ${direct.newUsers.current}，注册 ${direct.registrations.previous} → ${direct.registrations.current}；付费搜索新用户 ${paid.newUsers.previous} → ${paid.newUsers.current}，注册 ${paid.registrations.previous} → ${paid.registrations.current}。`,
    action: "优先排查直接访问渠道的来源结构、落地页和注册方式，不能将本次变化直接归因于 SEO。" });
  const country=Object.entries(data.directRegistrationCountries??{}).filter(([,row])=>row.current<row.previous).sort(([,a],[,b])=>(b.previous-b.current)-(a.previous-a.current))[0];
  const countryNames:Record<string,string>={China:"中国",Brazil:"巴西",Singapore:"新加坡",Japan:"日本","United States":"美国"};
  if (country) result.findings.push({ title: "直接访问注册下降最集中的地区", level: "finding",
    evidence: `${countryNames[country[0]]??country[0]}直接访问注册用户 ${country[1].previous} → ${country[1].current}，减少 ${country[1].previous-country[1].current} 人。地区是独立切片，跨地区用户可能重复，未与渠道人数重复相加。`,
    action: "核对该地区同期入口与推广来源、登录方式和访问错误日志；报表尚不能证明具体投放变化、网络故障或埋点变更。" });
  if (data.newVisitorFunnel && data.formFunnel) {
    const before = data.newVisitorFunnel.previous, after = data.newVisitorFunnel.current;
    const formBefore = data.formFunnel.previous, formAfter = data.formFunnel.current;
    result.findings.push({ title: "新访客与表单顺序漏斗变化", level: "finding",
      evidence: `首次访问后注册 ${before.at(-1)!.users}/${before[0].users}（${(before[0].completionRate!*100).toFixed(2)}%）→ ${after.at(-1)!.users}/${after[0].users}（${(after[0].completionRate!*100).toFixed(2)}%）；按首次访问→开始填表→提交→注册的完整路径，成功 ${formBefore.at(-1)!.users} → ${formAfter.at(-1)!.users}。`,
      action: "分别核对首次访问后进入表单、提交表单及注册完成的流失率。表单事件可能包含其他表单，也不覆盖所有登录方式，不能据此宣称整个注册系统无故障。" });
  }
  if (data.search) result.findings.push({ title: data.search.clicks.current<data.search.clicks.previous ? "Google 自然搜索点击下降" : "Google 自然搜索点击未下降", level: "finding",
    evidence: `GSC 全站点击 ${data.search.clicks.previous} → ${data.search.clicks.current}，曝光 ${data.search.impressions.previous} → ${data.search.impressions.current}。搜索点击与直接访问注册是不同的统计口径，不能仅凭同期变化认定因果。`,
    action: "分别观察搜索获客与注册转化。GA4 首次来源渠道和 GSC 点击口径不同，不能将两者人数直接相减。" });
  return result;
}
