import { propertyToday } from "./seo-date-range";

export const CLUSTER_SITES = [
  { domain: "mochichatbot.com", name: "MochiChatbot", ga4: "561876347", gsc: "sc-domain:mochichatbot.com", ga4TimeZone: "America/Los_Angeles" },
  { domain: "jev-llm.com", name: "JEV LLM", ga4: "555043733", gsc: "sc-domain:jev-llm.com", ga4TimeZone: "America/Los_Angeles" },
  { domain: "rackrate.org", name: "RackRate", ga4: "558899190", gsc: "https://rackrate.org/", ga4TimeZone: "Asia/Shanghai" },
  { domain: "modelfit.cc", name: "ModelFit", ga4: "558978062", gsc: "https://modelfit.cc/", ga4TimeZone: "Asia/Shanghai" },
  // Read-only onboarding verified in the managed GA4 account on 2026-11-23.
  // Google sources were explicitly deferred by the user on 2026-11-23. Keep
  // the property and existing evidence; collectors must not retry either source.
  { domain: "rougecue.org", name: "RougeCue", ga4: "565596386", gsc: null, ga4TimeZone: "America/Los_Angeles",
    googleCollectionDeferred: true, googleCollectionDeferReason: "user_deferred_google_sources" },
] as const;

export const ROUGECUE_SOURCE_VERIFICATION = {
  propertyId: "565596386", timezone: "America/Los_Angeles", streamId: "16396864047",
  website: "https://rougecue.org", verifiedAt: "2026-11-23",
  basis: "managed-account-ga4-visible-property-and-stream", apiPermissionVerified: false,
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
    sourceTimezone: collector?.ga4TimeZone ?? null, sourcePropertyId: collector?.ga4 ?? persistedPropertyId ?? null,
    sourceVerifiedAt: visibleVerification ? ROUGECUE_SOURCE_VERIFICATION.verifiedAt : null,
    configurationSource: collector ? "collector-registry" : persistedPropertyId ? "persisted-site" : "missing",
    metadataVerification: visibleVerification ? "visible-ga4-property" : "collector-config-only",
    apiPermissionVerified: false, persistedPropertyMatches: matches,
    reason: `${visibleVerification ? "Google属性、网站数据流及洛杉矶时区已只读核实" : collector ? "已有采集器属性及来源时区配置，未在本接口实时重查Google metadata" : "采集器未登记属性"}；${matches === true ? "平台持久配置已匹配" : matches === false ? "平台持久配置与采集器不符，须核对" : persistedPropertyId ? "已有平台持久属性配置" : "平台属性配置尚未持久登记"}。服务账号读取权限、注册事件及实际数据覆盖仍待核实，不将无数据补0。` };
}

export type ClusterDomain = typeof CLUSTER_SITES[number]["domain"];

export function clusterDomainForProperty(property: string): ClusterDomain | undefined {
  return CLUSTER_SITES.find(site => site.ga4 === property || site.gsc === property)?.domain;
}

export function siteReportToday(site?: ClusterDomain) {
  return propertyToday(CLUSTER_SITES.find(entry => entry.domain === site)?.ga4TimeZone ?? undefined);
}
