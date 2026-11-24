import { propertyToday } from "./seo-date-range";

export const CLUSTER_SITES = [
  { domain: "mochichatbot.com", name: "MochiChatbot", ga4: "561876347", gsc: "sc-domain:mochichatbot.com", ga4TimeZone: "America/Los_Angeles" },
  { domain: "jev-llm.com", name: "JEV LLM", ga4: "555043733", gsc: "sc-domain:jev-llm.com", ga4TimeZone: "America/Los_Angeles" },
  { domain: "rackrate.org", name: "RackRate", ga4: "558899190", gsc: "https://rackrate.org/", ga4TimeZone: "Asia/Shanghai" },
  { domain: "modelfit.cc", name: "ModelFit", ga4: "558978062", gsc: "https://modelfit.cc/", ga4TimeZone: "Asia/Shanghai" },
  // User authorized existing GA4/GSC read-only onboarding on 2026-11-24.
  // Registration does not establish API permission or make pending data zero.
  { domain: "rougecue.org", name: "RougeCue", ga4: "565596386", gsc: "sc-domain:rougecue.org", ga4TimeZone: "America/Los_Angeles",
    googleCollectionDeferred: false },
] as const;

export const ROUGECUE_SOURCE_VERIFICATION = {
  propertyId: "565596386", timezone: "America/Los_Angeles", streamId: "16396864047",
  website: "https://rougecue.org", verifiedAt: "2026-11-24",
  gscProperty: "sc-domain:rougecue.org", account: "jilin.zhang@mkt.voc.ai",
  basis: "managed-account-visible-ga4-property-stream-timezone-and-gsc-domain", apiPermissionVerified: false,
} as const;

export function rougeCueSourceReadiness(persistedPropertyId: string | null | undefined) {
  return siteSourceReadiness("rougecue.org", persistedPropertyId);
}

/** Configuration availability is separate from database registration and live access. */
export function siteSourceReadiness(domain: string, persistedPropertyId: string | null | undefined) {
  const collector = domain === "flatkey.ai" ? { ga4: "541304395", ga4TimeZone: "America/Los_Angeles" }
    : CLUSTER_SITES.find(site => site.domain === domain);
  const matches = persistedPropertyId && collector ? persistedPropertyId === collector.ga4 : null;
  const visibleVerification = domain === "rougecue.org";
  return { ga4Configured: Boolean(persistedPropertyId || collector?.ga4), persistentGa4Configured: Boolean(persistedPropertyId), collectorGa4Configured: Boolean(collector?.ga4),
    gscProperty: domain === "flatkey.ai" ? "sc-domain:flatkey.ai" : collector && "gsc" in collector ? collector.gsc : null,
    sourceTimezone: collector?.ga4TimeZone ?? null, sourcePropertyId: collector?.ga4 ?? persistedPropertyId ?? null,
    sourceVerifiedAt: visibleVerification ? ROUGECUE_SOURCE_VERIFICATION.verifiedAt : null,
    configurationSource: collector ? "collector-registry" : persistedPropertyId ? "persisted-site" : "missing",
    metadataVerification: visibleVerification ? "visible-ga4-property" : "collector-config-only",
    // This compatibility flag describes this configuration route's own scope;
    // false is not a failed permission check or the latest source availability.
    apiPermissionVerified: false, apiVerificationScope: "not-checked-by-this-route" as const, persistedPropertyMatches: matches,
    reason: `${visibleVerification ? "Google属性、网站数据流及洛杉矶时区已只读核实" : collector ? "已有采集器属性及来源时区配置，未在本接口实时重查Google metadata" : "采集器未登记属性"}；${matches === true ? "平台持久配置已匹配" : matches === false ? "平台持久配置与采集器不符，须核对" : persistedPropertyId ? "已有平台持久属性配置" : "平台属性配置尚未持久登记"}。采集可用性以来源台账实际回执/日期为准，本配置接口未实时复查服务账号权限、注册事件及数据覆盖；不将无数据补0。` };
}

export type ClusterDomain = typeof CLUSTER_SITES[number]["domain"];

export function clusterDomainForProperty(property: string): ClusterDomain | undefined {
  return CLUSTER_SITES.find(site => site.ga4 === property || site.gsc === property)?.domain;
}

export function siteReportToday(site?: ClusterDomain) {
  return propertyToday(CLUSTER_SITES.find(entry => entry.domain === site)?.ga4TimeZone ?? undefined);
}
