const PLATFORM_BUSINESS_URL = "https://flatkey-seo-roadmap.vercel.app/api/seo/business";

/** The collector can be merged before the user releases the new Vercel API.
 * Never send the optional schema to a legacy or unverified importer. */
async function resolveCohortCollectionGate({ coverageStart, importing, token, range, fetchImpl = fetch }) {
  if (!coverageStart) return { enabled: false, reason: "coverage_start_unverified" };
  if (!importing) return { enabled: true, reason: "read_only_no_import" };
  if (!token) return { enabled: false, reason: "import_token_missing" };
  const params = new URLSearchParams({ ...range, country: "all", scope: "all-channels" });
  try {
    const response = await fetchImpl(`${PLATFORM_BUSINESS_URL}?${params}`, { method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30000),
      headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) return { enabled: false, reason: `platform_capability_http_${response.status}` };
    const body = await response.json();
    return body?.capabilities?.apiCohorts === 1 ? { enabled: true, reason: "platform_schema_v1_verified" } : { enabled: false, reason: "platform_schema_not_ready" };
  } catch { return { enabled: false, reason: "platform_capability_unavailable" }; }
}

async function collectOptionalApiCohorts(record, query, gate, fetchCohorts) {
  if (!gate.enabled) return record;
  return { ...record, apiCohorts: await fetchCohorts(query, { now: new Date(record.observedAt), verifiedTimezone: record.timezone }) };
}

module.exports = { resolveCohortCollectionGate, collectOptionalApiCohorts };
