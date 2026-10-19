import type { WeeklyTrafficEvidence } from "./weekly-traffic-evidence";
import type { WeeklyReportDiagnosis } from "./weekly-report-diagnosis";

export function auditedWeeklyDiagnosis(data: WeeklyTrafficEvidence): WeeklyReportDiagnosis {
  if (!data.complete) return { significant: false, findings: [] };
  const direct = data.channels.find(row => row.name === "Direct"), paid = data.channels.find(row => row.name === "Paid Search");
  const china = data.directRegistrationCountries?.China;
  const result: WeeklyReportDiagnosis = { significant: true, findings: [] };
  if (direct && paid) result.findings.push({ title: "增长渠道与注册减少渠道不同", level: "finding",
    evidence: `直接访问新用户 ${direct.newUsers.previous} → ${direct.newUsers.current}，注册 ${direct.registrations.previous} → ${direct.registrations.current}；付费搜索新用户 ${paid.newUsers.previous} → ${paid.newUsers.current}，注册 ${paid.registrations.previous} → ${paid.registrations.current}。直接访问少 ${direct.registrations.previous-direct.registrations.current} 人，付费搜索多 ${paid.registrations.current-paid.registrations.previous} 人，未完全抵消。`,
    action: "优先排查直接访问渠道的来源结构、落地页和注册方式，不能将本次变化直接归因于 SEO。" });
  if (china) result.findings.push({ title: "直接访问的下降主要集中在中国", level: "finding",
    evidence: `中国直接访问注册用户 ${china.previous} → ${china.current}，减少 ${china.previous-china.current} 人。地区是独立切片，跨地区用户可能重复，未与渠道人数重复相加。`,
    action: "核对同期中国入口与推广来源、登录方式和访问错误日志；现有报表尚不能证明具体投放变化、网络故障或埋点变更。" });
  if (data.newVisitorFunnel && data.formFunnel) {
    const before = data.newVisitorFunnel.previous, after = data.newVisitorFunnel.current;
    const formBefore = data.formFunnel.previous, formAfter = data.formFunnel.current;
    result.findings.push({ title: "新访客注册率下降，表单链路并未整体恶化", level: "finding",
      evidence: `首次访问后注册 ${before.at(-1)!.users}/${before[0].users}（${(before[0].completionRate!*100).toFixed(2)}%）→ ${after.at(-1)!.users}/${after[0].users}（${(after[0].completionRate!*100).toFixed(2)}%）；按首次访问→开始填表→提交→注册的完整路径，成功 ${formBefore.at(-1)!.users} → ${formAfter.at(-1)!.users}。`,
      action: "两条漏斗均按实际事件顺序去重；表单事件可能包含其他表单，也不覆盖所有登录方式。应重点核对直接访问的非表单注册方式及对应埋点，不能据此宣称整个注册系统无故障。" });
  }
  if (data.search) result.findings.push({ title: "Google 自然搜索点击没有整体下降", level: "finding",
    evidence: `GSC 全站点击 ${data.search.clicks.previous} → ${data.search.clicks.current}，曝光 ${data.search.impressions.previous} → ${data.search.impressions.current}。局部页面存在减少，但不足以解释全部直接访问注册变化。`,
    action: "分别观察搜索获客与注册转化。GA4 首次来源渠道和 GSC 点击口径不同，不能将两者人数直接相减。" });
  return result;
}
