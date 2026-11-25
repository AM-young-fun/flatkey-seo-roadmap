const fs = require("node:fs/promises");
const path = require("node:path");
const { bootstrap } = require("./server-seo-report-scalars.cjs");
const { collectGrowthRollingTraffic } = require("./lib/seo-growth-weekly-traffic.cjs");

async function main() {
  bootstrap();
  const { fetchGa4RollingOrganicWeek } = require("../src/lib/services/ga4-organic.ts");
  const { latestClosedLa7DayRange, shiftDay } = require("../src/lib/seo-date-range.ts");
  const option = name => process.argv.find(value => value.startsWith("--" + name + "="))?.slice(name.length + 3);
  const credentialPath = option("settings");
  let credential = process.env.SEO_IMPORT_TOKEN;
  if (!credential && credentialPath) {
    const { tokenFile } = JSON.parse(await fs.readFile(credentialPath, "utf8"));
    const stat = await fs.lstat(tokenFile);
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw Error("collector_token_file_permissions");
    credential = (await fs.readFile(tokenFile, "utf8")).trim();
  }
  if (!credential) throw Error("missing_growth_import_credential");
  const now = new Date(), current = latestClosedLa7DayRange(now);
  const scopes = [current, { start: shiftDay(current.start, -1), end: shiftDay(current.end, -1) }];
  const sites = [{ domain: "flatkey.ai", ga4: "541304395", ga4TimeZone: "America/Los_Angeles" }];
  const results = [];
  for (const period of scopes) {
    results.push(await collectGrowthRollingTraffic({ sites, period, fetchWeek: fetchGa4RollingOrganicWeek, credential, now }));
  }
  const output = path.resolve(option("out") ?? ".local/seo-traffic-summary/rolling-" + current.end + ".json");
  await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  await fs.writeFile(output, JSON.stringify({ observedAt: now.toISOString(), results }, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ output, results }));
  if (results.some(result => !result.complete)) process.exitCode = 1;
}
main().catch(error => { console.error(error.code ?? error.message); process.exitCode = 1; });
