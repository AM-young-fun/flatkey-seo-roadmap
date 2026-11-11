// GA4 event totals are queried independently for each interval, channel and country.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, "..");
require("@next/env").loadEnvConfig(root, true);
const resolve = Module._resolveFilename, load = Module._load;
Module._resolveFilename = function(name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
Module._load = function(name, ...rest) { return name === "server-only" ? {} : load.call(this, name, ...rest); };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { fetchGa4Journey, fetchGa4Engagement } = require("../src/lib/services/ga4-journeys.ts");
const { fetchGa4Business } = require("../src/lib/services/ga4-business.ts");
const { businessAnalyticsSchema, businessAnalyticsId } = require("../src/lib/seo-business-analytics.ts");
const { organicReportWindows } = require("../src/lib/seo-organic-period.ts");
const { shiftDay, propertyToday } = require("../src/lib/seo-date-range.ts");

async function run() {
  const importResults = process.argv.includes("--import");
  if (importResults && !process.env.SEO_IMPORT_TOKEN) throw Error("missing_import_token");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  const last = shiftDay(propertyToday("America/Los_Angeles"), -1);
  const windows = [...new Map([{ start: last, end: last }, { start: shiftDay(last, -6), end: last }, ...organicReportWindows(today, last)].map(row => [row.start + ":" + row.end, row])).values()];
  let fetched = 0, imported = 0;
  const failures = [];
  for (const range of windows) for (const country of ["all", "US", "JP", "BR", "ES"]) for (const scope of ["all-channels", "session-organic-search"]) {
    try {
      const query = { ...range, country, scope };
      const record = await fetchGa4Business(query);
      record.engagement = await fetchGa4Engagement(query);
      if (scope === "all-channels") record.journeys = await Promise.all([fetchGa4Journey(query, "gpu"), fetchGa4Journey(query, "api")]);
      businessAnalyticsSchema.parse(record); fetched++;
      if (!importResults) continue;
      const response = await fetch("https://flatkey-seo-roadmap.vercel.app/api/seo/business", { method: "POST", redirect: "error", signal: AbortSignal.timeout(60000), headers: { "content-type": "application/json", authorization: "Bearer " + process.env.SEO_IMPORT_TOKEN }, body: JSON.stringify(record) });
      if (!response.ok) throw Error("business_import_" + response.status);
      const receipt = await response.json();
      if (receipt.stored !== true || receipt.id !== businessAnalyticsId(businessAnalyticsSchema.parse(receipt.record))) throw Error("business_readback_failed");
      imported++;
    } catch (error) { failures.push({ ...range, country, scope, error: error.code || (/^business_[a-z_0-9]+$/.test(error.message) ? error.message : "collection_failed") }); }
  }
  console.log(JSON.stringify({ kind: "ga4-business", mode: importResults ? "import" : "read_only", fetched, imported, failures, windows }));
  if (failures.length) process.exitCode = 1;
}
if (require.main === module) run().catch(error => { console.error(JSON.stringify({ error: error.code || "business_collection_failed" })); process.exitCode = 1; });
