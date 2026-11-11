/** Exact production domains. Shared GA4 properties are not evidence of site ownership. */
export const GA4_HOST_SCOPE = "production-hosts-v1" as const;
export const FLATKEY_ENTRY_HOSTS = ["flatkey.ai", "www.flatkey.ai", "console.flatkey.ai"] as const;
export const FLATKEY_BUSINESS_HOSTS = [...FLATKEY_ENTRY_HOSTS, "router.flatkey.ai"] as const;
export const GA4_HOST_UNVERIFIED = "主站 GA4 旧汇总未核验正式域名，可能混入集群或测试流量；等待按生产域名重采，缺失不计为零。";
export const ga4HostFilter = (hosts: readonly string[]) => ({ filter: { fieldName: "hostName", inListFilter: { values: [...hosts], caseSensitive: false } } });
export const isFlatkeyEntryHost = (host: string | null | undefined) => FLATKEY_ENTRY_HOSTS.some(value => value === host?.toLowerCase());
