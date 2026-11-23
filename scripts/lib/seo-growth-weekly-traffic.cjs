const { createHash } = require("node:crypto");

const endpoint = "https://flatkey-seo-roadmap.vercel.app/api/seo/growth/strategy";
const goalSites = new Set(["flatkey.ai", "rackrate.org", "modelfit.cc", "rougecue.org"]);
const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
const canonical = value => JSON.stringify(normalize(value));
const same = (a, b) => canonical(a) === canonical(b);

/** Uses only the original authorized Google reader and original import token.
 * Four independent reads run together. CAS writes are serial; ambiguous writes
 * get one readback and are never blindly repeated. No provider or paid path. */
async function collectGrowthWeeklyTraffic({ sites, period, fetchWeek, credential, now, fetcher = fetch }) {
  if (!credential) throw new Error("missing_growth_import_credential");
  const selected = sites.filter(site => goalSites.has(site.domain));
  if (new Set(selected.map(site => site.domain)).size !== selected.length) throw new Error("growth_duplicate_source_site");
  const api = async command => {
    const response = await fetcher(endpoint, { method: command ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(180000),
      headers: { authorization: "Bearer " + credential, ...(command ? { "content-type": "application/json" } : {}) },
      ...(command ? { body: JSON.stringify(command) } : {}) });
    if (!response.ok) throw new Error("growth_production_" + response.status);
    const body = await response.json();
    if (!body.state || !Number.isInteger(body.state.version) || !Array.isArray(body.state.trafficEvidence)) throw new Error("invalid_growth_readback");
    return body.state;
  };
  const outcomes = await Promise.all(selected.map(async site => {
    try { return { site: site.domain, evidence: await fetchWeek(site.domain, site.ga4, site.ga4TimeZone, period, now) }; }
    catch (error) { return { site: site.domain, status: "source_unavailable", reason: typeof error?.code === "string" ? error.code : "exact_window_unavailable" }; }
  }));
  const results = [];
  for (const outcome of outcomes) {
    if (!outcome.evidence) { results.push(outcome); continue; }
    const evidence = outcome.evidence;
    try {
      const current = await api();
      const prior = current.trafficEvidence.find(row => row.id === evidence.id);
      if (prior) {
        if (!same(prior, evidence)) throw new Error("growth_evidence_identity_conflict");
        results.push({ site: outcome.site, status: "read_back", evidenceId: evidence.id, sessions: evidence.sessions }); continue;
      }
      const requestId = "ga4-week-" + createHash("sha256").update(canonical(evidence)).digest("hex");
      let writeError;
      try { await api({ action: "record_traffic", requestId, expectedVersion: current.version, evidence }); } catch (error) { writeError = error; }
      const readback = await api(), saved = readback.trafficEvidence.find(row => row.id === evidence.id);
      if (!saved || !same(saved, evidence)) throw writeError ?? new Error("growth_traffic_readback_failed");
      results.push({ site: outcome.site, status: "read_back", evidenceId: evidence.id, sessions: evidence.sessions, version: readback.version });
    } catch (error) {
      results.push({ site: outcome.site, status: "save_unavailable", reason: /^growth_|^invalid_growth_/.test(error?.message) ? error.message : "growth_traffic_save_failed" });
    }
  }
  return { period, results, complete: [...goalSites].every(site => results.filter(row => row.site === site && row.status === "read_back").length === 1), paidRequests: 0 };
}

module.exports = { collectGrowthWeeklyTraffic };
