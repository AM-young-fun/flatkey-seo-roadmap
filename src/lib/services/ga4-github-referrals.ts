import "server-only";
import { getGoogleReadAccessToken } from "../google-read-auth";
import { PROMPT_REPOSITORIES, githubReferralSchema, githubChannelSchema, type GithubChannel } from "../seo-github-channel";

/** Preserve the GitHub snapshot date; each Google observation has its own timestamp. */
export async function enrichGithubReferrals(records: GithubChannel[], windows: { start: string; end: string }[], fetcher = fetchGithubReferrals): Promise<GithubChannel[]> {
  const enriched: GithubChannel[] = [];
  for (const repository of PROMPT_REPOSITORIES) {
    const record = records.filter(row => row.repository === repository).sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
    if (!record) continue;
    const referrals = [...record.referrals];
    for (const range of windows) {
      const referral = githubReferralSchema.parse(await fetcher(repository, range.start, range.end));
      const index = referrals.findIndex(row => row.start === referral.start && row.end === referral.end);
      if (index < 0) referrals.push(referral); else referrals[index] = referral;
    }
    enriched.push(githubChannelSchema.parse({ ...record, referrals: referrals.sort((a, b) => b.observedAt.localeCompare(a.observedAt)).slice(0, 8) }));
  }
  return enriched;
}

export async function fetchGithubReferrals(repository: typeof PROMPT_REPOSITORIES[number], start: string, requestedEnd: string, now = new Date()) {
  const timezone = "America/Los_Angeles" as const;
  const localToday = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
  const closedDay = new Date(Date.parse(localToday + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
  const end = requestedEnd < closedDay ? requestedEnd : closedDay;
  const base = { start, end: end < start ? start : end, timezone, observedAt: now.toISOString() };
  if (end < start) return githubReferralSchema.parse({ ...base, status: "unavailable", sessions: null, users: null, reason: "property_day_not_closed" });
  try {
    const token = process.env.SEO_GA4_ACCESS_TOKEN?.trim() || await getGoogleReadAccessToken("https://www.googleapis.com/auth/analytics.readonly");
    const exact = (fieldName: string, value: string) => ({ filter: { fieldName, stringFilter: { matchType: "EXACT", value, caseSensitive: true } } });
    const response = await fetch("https://analyticsdata.googleapis.com/v1beta/properties/541304395:runReport", { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30000), headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ dateRanges: [{ startDate: start, endDate: end }], metrics: [{ name: "sessions" }, { name: "totalUsers" }], dimensionFilter: { andGroup: { expressions: [exact("sessionSource", "github"), exact("sessionMedium", "referral"), exact("sessionCampaignName", repository.split("/")[1]), { filter: { fieldName: "hostName", inListFilter: { values: ["flatkey.ai", "www.flatkey.ai", "console.flatkey.ai"] } } }] } }, limit: 1 }) });
    if (!response.ok) throw Error("ga4_http_" + response.status);
    const result = await response.json();
    if (result.metadata?.timeZone !== timezone || result.metricHeaders?.[0]?.name !== "sessions" || result.metricHeaders?.[1]?.name !== "totalUsers" || result.rows?.length > 1) {
      // Schema-only diagnostics: never log authorization, rows or user identifiers.
      console.warn(JSON.stringify({ kind: "ga4-referral-schema", timezone: result.metadata?.timeZone ?? null, emptyReason: result.metadata?.emptyReason ?? null, metricHeaders: result.metricHeaders?.map((row: { name: string }) => row.name) ?? [], rowCount: result.rowCount ?? null, rowArrayLength: result.rows?.length ?? null }));
      throw Error(result.metadata?.timeZone !== timezone ? "ga4_timezone_missing_or_mismatch" : "ga4_response_mismatch");
    }
    if (result.metadata.subjectToThresholding || result.metadata.dataLossFromOtherRow || result.metadata.samplingMetadatas?.length || result.metadata.schemaRestrictionResponse || result.metadata.dataTruncationReasons?.length) return githubReferralSchema.parse({ ...base, status: "partial", sessions: null, users: null, reason: "ga4_threshold_or_incomplete" });
    const read = (index: number) => { const value = result.rows?.[0]?.metricValues?.[index]?.value ?? "0"; if (!/^\d+$/.test(value)) throw Error("ga4_invalid_metric"); return Number(value); };
    return githubReferralSchema.parse({ ...base, status: "ok", sessions: read(0), users: read(1), reason: end < requestedEnd ? "last_property_day_not_closed" : null });
  } catch (error) { return githubReferralSchema.parse({ ...base, status: "unavailable", sessions: null, users: null, reason: error instanceof Error && /^ga4_[a-z0-9_]+$/.test(error.message) ? error.message : "ga4_source_unavailable" }); }
}
