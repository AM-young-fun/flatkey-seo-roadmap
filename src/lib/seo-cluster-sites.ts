import { propertyToday } from "./seo-date-range";

export const CLUSTER_SITES = [
  { domain: "mochichatbot.com", name: "MochiChatbot", ga4: "561876347", gsc: null, ga4TimeZone: "America/Los_Angeles" },
  { domain: "jev-llm.com", name: "JEV LLM", ga4: "555043733", gsc: null, ga4TimeZone: "America/Los_Angeles" },
  { domain: "rackrate.org", name: "RackRate", ga4: "558899190", gsc: "https://rackrate.org/", ga4TimeZone: "Asia/Shanghai" },
  { domain: "modelfit.cc", name: "ModelFit", ga4: "558978062", gsc: "https://modelfit.cc/", ga4TimeZone: "Asia/Shanghai" },
] as const;

export type ClusterDomain = typeof CLUSTER_SITES[number]["domain"];

export function clusterDomainForProperty(property: string): ClusterDomain | undefined {
  return CLUSTER_SITES.find(site => site.ga4 === property || site.gsc === property)?.domain;
}

export function siteReportToday(site?: ClusterDomain) {
  return propertyToday(CLUSTER_SITES.find(entry => entry.domain === site)?.ga4TimeZone ?? undefined);
}
