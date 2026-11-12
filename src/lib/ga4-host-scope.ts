/** Exact production domains. Shared GA4 properties are not evidence of site ownership. */
export const GA4_HOST_SCOPE = "production-hosts-v1" as const;
export const FLATKEY_ENTRY_HOSTS = ["flatkey.ai", "www.flatkey.ai", "console.flatkey.ai"] as const;
export const FLATKEY_BUSINESS_HOSTS = [...FLATKEY_ENTRY_HOSTS, "router.flatkey.ai"] as const;
export const GA4_HOST_UNVERIFIED = "无生产域名归属的旧汇总已排除；当前仅展示已核验数据，缺失区间保持待更新。";
export const ga4HostFilter = (hosts: readonly string[]) => ({ filter: { fieldName: "hostName", inListFilter: { values: [...hosts], caseSensitive: false } } });
export const isFlatkeyEntryHost = (host: string | null | undefined) => FLATKEY_ENTRY_HOSTS.some(value => value === host?.toLowerCase());

export const GA4_REGISTRATION_METRIC = "sign_up_or_legacy_distinct_users" as const;
export const GA4_REGISTRATION_EVENTS = ["sign_up", "sign_up_success"] as const;
export const ga4RegistrationFilter = () => ({ filter: { fieldName: "eventName", inListFilter: { values: [...GA4_REGISTRATION_EVENTS], caseSensitive: true } } });
export const ga4RegistrationFunnelFilter = () => ({ orGroup: { expressions: GA4_REGISTRATION_EVENTS.map(eventName => ({ funnelEventFilter: { eventName } })) } });
