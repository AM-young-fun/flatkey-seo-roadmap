// Independent full-interval user queries. Daily distinct-user rows are never summed.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, "..");
require("@next/env").loadEnvConfig(root, true);
const resolve = Module._resolveFilename, load = Module._load;
Module._resolveFilename = function(name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
Module._load = function(name, ...rest) { return name === "server-only" ? {} : load.call(this, name, ...rest); };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { fetchGa4OrganicPeriod } = require("../src/lib/services/ga4-organic.ts");
const { organicPeriodSchema, organicPeriodId, organicReportWindows } = require("../src/lib/seo-organic-period.ts");
const { shiftDay, propertyToday } = require("../src/lib/seo-date-range.ts");
async function run() {
 if (!process.env.SEO_IMPORT_TOKEN || !process.env.SEO_GOOGLE_SERVICE_ACCOUNT_JSON) throw Error("missing_server_credentials");
 const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
 const windows = organicReportWindows(today, shiftDay(propertyToday("America/Los_Angeles"), -1));
 let imported = 0; const periods = [];
 for (const range of windows) {
  const report = await fetchGa4OrganicPeriod(range);
  const row = organicPeriodSchema.parse({ hostScope: report.hostScope, ...range, siteDomain: "flatkey.ai", propertyId: report.propertyId, timezone: report.timezone, country: "all", source: "google-api", scope: report.scope, channelDimension: "sessionDefaultChannelGroup", users: report.users, registrations: report.registrations, registrationEvent: report.registrationMetric, distinctOverWholePeriod: true, observedAt: report.fetchedAt, complete: report.quality.complete, reasons: report.quality.reasons });
  const response = await fetch("https://flatkey-seo-roadmap.vercel.app/api/seo/periods", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + process.env.SEO_IMPORT_TOKEN }, body: JSON.stringify(row), redirect: "error", signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error("period_import_" + response.status);
  const receipt = await response.json();
  if (receipt.stored !== true || receipt.id !== organicPeriodId(organicPeriodSchema.parse(receipt.period))) throw Error("period_readback_failed");
  imported++; periods.push({start:row.start,end:row.end,timezone:row.timezone,hostScope:row.hostScope,registrationEvent:row.registrationEvent,users:row.users,registrations:row.registrations,complete:row.complete,reasons:row.reasons});
 }
 console.log(JSON.stringify({ kind: "organic-period", imported, windows, periods }));
}
if (require.main === module) run().catch(error => { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; });
