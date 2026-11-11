#!/usr/bin/env node
"use strict";
// Read-only real API captures for local UI review. Never synthesize a module
// from all-site totals, and never trigger a provider/paid SERP request.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

async function main() {
  const token = process.env.SEO_IMPORT_TOKEN;
  const origin = process.env.SEO_PLATFORM_ORIGIN;
  if (!token || !origin) throw new Error("SEO_PREVIEW_READ_CREDENTIALS_MISSING");
  const parsed = new URL(origin);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/") throw new Error("SEO_PLATFORM_ORIGIN_INVALID");
  const directory = path.resolve(__dirname, "../.local");
  fs.mkdirSync(directory, { recursive: true });
  const end = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  const start = ["2026-10-08", new Date(Date.parse(end + "T00:00:00Z") - 89 * 86400000).toISOString().slice(0, 10)].sort().at(-1);
  const evidence = { capturedAt: new Date().toISOString(), origin: parsed.origin, start, end, modules: [] };
  for (const module of ["all", "blog", "gpu"]) {
    const url = new URL("/api/seo/trends", parsed);
    url.search = new URLSearchParams({ region: "all", module, start, end, refresh: "1" }).toString();
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(70000) });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const value = await response.json();
      if (value.schemaVersion !== 5 || value.mode !== "serp-markets" || value.start !== start || value.end !== end ||
          value.moduleScope?.module !== module || value.moduleScope?.basis !== "current-registered-target-pages" || !Array.isArray(value.markets))
        throw new Error("MODULE_SCOPE_UNVERIFIED");
      const body = JSON.stringify(value, null, 2) + "\n", destination = path.join(directory, `preview-trends-${module}.json`);
      fs.writeFileSync(destination, body, { mode: 0o600 });
      const point = value.points?.at(-1), jp = value.markets.find(market => market.region === "JP");
      evidence.modules.push({ module, status: "captured", file: path.basename(destination), sha256: createHash("sha256").update(body).digest("hex"),
        periods: value.points?.length ?? null, latestTotal: point?.total ?? null, latestRanked: point?.ranked ?? null,
        japanStatus: jp?.status ?? "MISSING", japanPeriods: jp?.points?.length ?? null });
    } catch (error) {
      // Log only fixed error codes, never raw headers/body or credential values.
      const code = /^(HTTP_\d+|MODULE_SCOPE_UNVERIFIED)$/.test(error.message) ? error.message : "READ_FAILED";
      evidence.modules.push({ module, status: "unavailable", code });
    }
  }
  fs.writeFileSync(path.join(directory, "preview-trends-provenance.json"), JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.modules.some(row => row.status !== "captured")) process.exitCode = 1;
}
main().catch(error => { console.error(/^[A-Z_]+$/.test(error.message) ? error.message : "TREND_CAPTURE_FAILED"); process.exitCode = 1; });
