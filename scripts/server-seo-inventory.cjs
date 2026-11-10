const fs = require("node:fs");
const endpoint = "https://flatkey-seo-roadmap.vercel.app/api/seo/pages";
async function request(method) {
 const r = await fetch(endpoint, { method, headers: { authorization: "Bearer " + process.env.SEO_IMPORT_TOKEN }, redirect: "error", signal: AbortSignal.timeout(90000) });
 if (!r.ok) throw Error("inventory_http_" + r.status);
 const value = await r.json();
 if (value.storage !== "database" || !Array.isArray(value.pages)) throw Error("inventory_invalid_response");
 return value;
}
async function run() {
 if (!process.env.SEO_IMPORT_TOKEN) throw Error("inventory_missing_credential");
 const before = await request("GET");
 const started = Date.now();
 const updated = await request("POST");
 const after = await request("GET");
 const urls = new Set(after.pages.map(p => p.url));
 const prior = new Set(before.pages.map(p => p.url));
 if (!updated.pages.length || !updated.pages.every(p => urls.has(p.url)) || Date.parse(after.capturedAt) < started - 5000) throw Error("inventory_readback_failed");
 const result = { status: "success", pages: after.pages.length, added: after.pages.filter(p => !prior.has(p.url)).length };
 console.log(JSON.stringify(result));
 if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Page inventory\n\nSynced and read back ${result.pages} pages; added ${result.added}.\n`);
}
run().catch(error => { console.error(/^inventory_/.test(error.message) ? error.message : "inventory_failed"); process.exitCode = 1; });
