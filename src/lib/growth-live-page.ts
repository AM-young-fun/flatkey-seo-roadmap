export const GROWTH_LIVE_PAGE_POLICY = "published-page-evidence-v1";
export type GrowthLivePageCheck = { site: string; keywordId: string | null; url: string | null; checkedAt: string; httpStatus: number | null; canonicalUrl: string | null; verified: boolean; source: string };

const sites = new Set(["flatkey.ai", "rackrate.org", "modelfit.cc"]);
const privateSegments = new Set(["api", "console", "router", "admin", "sign-in", "sign-up", "login", "auth", "billing", "account"]);
const day = 24 * 60 * 60 * 1000;

/** The audit API admits arbitrary subdomains for historical evidence. New paid
 * eligibility is narrower: public website hosts and paths only. */
function websiteUrl(value: string | null, site: string): string | null {
  if (typeof value !== "string" || value.length > 2000 || /\s/u.test(value)) return null;
  try {
    const authority = /^https:\/\/([^/?#]+)/iu.exec(value)?.[1].toLowerCase();
    if (!authority || ![site, `www.${site}`].includes(authority)) return null;
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || ![site, `www.${site}`].includes(url.hostname)) return null;
    let decoded = url.pathname;
    if (/%(?![a-f0-9]{2})/iu.test(decoded)) return null;
    for (let count = 0; count < 4 && /%[a-f0-9]{2}/iu.test(decoded); count++) decoded = decodeURIComponent(decoded);
    // RackRate's exact /api route renders its public pricing API overview;
    // /api/* remains a data endpoint, as do API paths on the other sites.
    const publicApiOverview = site === "rackrate.org" && (url.pathname === "/api" || url.pathname === "/api/");
    if (/%[a-f0-9]{2}/iu.test(decoded) || !publicApiOverview && decoded.normalize("NFKC").toLowerCase().replace(/\\/gu, "/").split("/").some(segment => privateSegments.has(segment))) return null;
    url.hostname = site; url.hash = "";
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.href;
  } catch { return null; }
}

function time(value: string): number | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.exec(value);
  if (!match) return null;
  const date = Date.parse(match[1] + "T00:00:00Z"), instant = Date.parse(value);
  return Number.isFinite(date) && new Date(date).toISOString().slice(0, 10) === match[1] && Number.isFinite(instant) ? instant : null;
}

function explicitCanonicalConflict(check: GrowthLivePageCheck, url: string, site: string): boolean {
  if (!check.canonicalUrl?.trim()) return false;
  try {
    const canonical = new URL(check.canonicalUrl);
    return ["https:", "http:"].includes(canonical.protocol) && websiteUrl(check.canonicalUrl, site) !== url;
  } catch { return false; }
}

/** Pure selection of existing facts. It fetches nothing and never changes the
 * target, raw checks, planning state or paid authorization. */
export function growthLivePageReadiness(
  target: { site: string; keywordId: string | null; publishedUrls: string[] }, checks: GrowthLivePageCheck[], now: Date,
): { urls: string[]; reason: string | null } {
  if (!sites.has(target.site)) return { urls: [], reason: "published_page_url_out_of_scope" };
  const urls = [...new Set(target.publishedUrls.flatMap(value => websiteUrl(value, target.site) ?? []))];
  if (!urls.length) return { urls: [], reason: "published_page_url_out_of_scope" };
  const nowAt = now.getTime();
  if (!Number.isFinite(nowAt)) return { urls: [], reason: "published_page_live_unverified" };
  const scoped = checks.filter(check => check.site === target.site);
  const noMatch = scoped.filter(check => target.keywordId !== null && check.keywordId === target.keywordId && check.url === null && !check.verified);
  let stale = false;
  const ready = urls.filter(url => {
    const observations: Array<{ at: number | null; positive: boolean }> = noMatch.map(check => ({ at: time(check.checkedAt), positive: false }));
    for (const check of scoped) {
      if (websiteUrl(check.url, target.site) !== url) continue;
      const own = check.keywordId === target.keywordId || check.keywordId === null;
      const sourced = typeof check.source === "string" && check.source.trim().length > 0;
      const positive = sourced && check.verified && check.httpStatus === 200 && websiteUrl(check.canonicalUrl, target.site) === url;
      const explicitFailure = Number.isInteger(check.httpStatus) && check.httpStatus !== null && check.httpStatus >= 100 && check.httpStatus <= 599 && check.httpStatus !== 200;
      if (own || sourced && (explicitFailure || explicitCanonicalConflict(check, url, target.site))) observations.push({ at: time(check.checkedAt), positive: own && positive });
    }
    // An invalid current own receipt cannot be made earlier than a valid one.
    if (!observations.length || observations.some(check => check.at === null)) return false;
    const latestAt = Math.max(...observations.map(check => check.at!));
    if (latestAt > nowAt || observations.some(check => check.at === latestAt && !check.positive)) return false;
    if (nowAt - latestAt > day) { stale = true; return false; }
    return true;
  });
  return { urls: ready, reason: ready.length ? null : stale ? "published_page_live_stale" : "published_page_live_unverified" };
}
