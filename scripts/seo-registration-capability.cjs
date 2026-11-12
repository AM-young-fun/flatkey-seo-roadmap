const URL_BASE = "https://flatkey-seo-roadmap.vercel.app/api/seo/business";
/** New collectors may run before Vercel imports accept the optional provenance
 * field. Preserve the legacy query/payload until that exact capability exists. */
async function resolveRegistrationCollectionGate({ importing, token, range, fetchImpl = fetch }) {
  if (!importing) return { enabled: true, reason: "read_only_no_import" };
  if (!token) return { enabled: false, reason: "import_token_missing" };
  try {
    const params = new URLSearchParams({ ...range, country: "all", scope: "all-channels" });
    const response = await fetchImpl(`${URL_BASE}?${params}`, { method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30000), headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) return { enabled: false, reason: `platform_capability_http_${response.status}` };
    const body = await response.json();
    return body?.capabilities?.registrationCompatibility === 1 ? { enabled: true, reason: "registration_schema_verified" } : { enabled: false, reason: "platform_registration_schema_not_ready" };
  } catch { return { enabled: false, reason: "platform_capability_unavailable" }; }
}
module.exports = { resolveRegistrationCollectionGate };
