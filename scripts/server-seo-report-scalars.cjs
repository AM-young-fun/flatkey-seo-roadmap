const path = require("node:path"), fs = require("node:fs"), Module = require("node:module");
const root = path.resolve(__dirname, "..");
const { collectDailyReportScalars, dayAt } = require("./lib/seo-report-ga4-scalars.cjs");
function bootstrap() {
  require("@next/env").loadEnvConfig(root, true);
  const ts = require("typescript"), original = Module._load;
  Module._load = function (name, ...args) { return name === "server-only" ? {} : original.call(this, name, ...args); };
  require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
}
async function runDailyReportScalars({ sourceDate, outputDirectory, cacheDirectories = [], offline = false, now = new Date() } = {}) {
  const { getGoogleReadAccessToken } = require("../src/lib/google-read-auth.ts");
  const { PILLAR_PAGE_GROUPS } = require("../src/lib/weekly-page-visitors.ts");
  const { DAILY_SEO_PAGE_GROUPS } = require("../src/lib/daily-seo-page-groups.ts");
  const { FLATKEY_ENTRY_HOSTS } = require("../src/lib/ga4-host-scope.ts");
  sourceDate ??= new Date(Date.parse(dayAt(now) + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
  outputDirectory ??= process.env.SEO_REPORT_SCALAR_OUTPUT_DIR || (process.env.SEO_COLLECTION_RESULT ? path.join(path.dirname(process.env.SEO_COLLECTION_RESULT), "report-scalars") : path.join(root, ".local", "seo-report-scalars", sourceDate));
  const shared = process.env.SEO_REPORT_SCALAR_CACHE_DIR || path.join(root, ".local", "seo-report-scalars-cache");
  const requestReport = async request => {
    const token = await getGoogleReadAccessToken("https://www.googleapis.com/auth/analytics.readonly");
    const response = await fetch("https://analyticsdata.googleapis.com/v1beta/properties/541304395:runReport", { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(45000), headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify(request) });
    return { status: response.status, observedAt: new Date().toISOString(), data: await response.json() };
  };
  const result = await collectDailyReportScalars({ sourceDate, definitions: { pillars: PILLAR_PAGE_GROUPS, pageGroups: DAILY_SEO_PAGE_GROUPS, entryHosts: FLATKEY_ENTRY_HOSTS }, outputDirectory, cacheDirectories: [shared, ...cacheDirectories], requestReport, offline, now });
  await require("node:fs/promises").mkdir(shared, { recursive: true, mode: 0o700 });
  for (const row of result.records) if (row.value !== null) await require("node:fs/promises").copyFile(row.sourceFile, path.join(shared, path.basename(row.sourceFile)));
  return result;
}
if (require.main === module) {
  bootstrap();
  const flag = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const cacheDirectories = process.argv.filter(arg => arg.startsWith("--reuse-dir=")).map(arg => arg.slice(12));
  runDailyReportScalars({ sourceDate: flag("source-date"), outputDirectory: flag("out"), cacheDirectories, offline: process.argv.includes("--offline") })
    .then(result => console.log(JSON.stringify({ complete: result.complete, requests: result.requests, cacheHits: result.cacheHits, summaryPath: result.summaryPath, missing: result.missing })))
    .catch(error => { console.error(error.code ?? error.message); process.exitCode = 1; });
}
module.exports = { runDailyReportScalars, bootstrap };
