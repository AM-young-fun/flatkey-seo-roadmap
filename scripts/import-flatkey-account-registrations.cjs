#!/usr/bin/env node

const { readFile } = require("node:fs/promises");

async function main() {
  const file = process.argv[2];
  const token = process.env.SEO_IMPORT_TOKEN?.trim();
  if (!file || !token) throw Error("usage: SEO_IMPORT_TOKEN=<configured> node scripts/import-flatkey-account-registrations.cjs path-to-snapshot.json");
  const origin = new URL(process.env.SEO_PLATFORM_ORIGIN || "https://flatkey-seo-roadmap.vercel.app");
  if (origin.origin !== "https://flatkey-seo-roadmap.vercel.app" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))) {
    throw Error("unexpected_platform_origin");
  }
  const snapshot = JSON.parse(await readFile(file, "utf8"));
  const url = new URL("/api/seo/account-registrations", origin);
  const request = async (body) => {
    const response = await fetch(url, {
      method: body ? "POST" : "GET", headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      redirect: "error", signal: AbortSignal.timeout(45000), ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw Error("account_registration_import_http_" + response.status);
    return response.json();
  };
  const receipt = await request(snapshot);
  const days = [...snapshot.days].sort((a, b) => a.date.localeCompare(b.date));
  if (!receipt.stored || receipt.record?.observedAt !== snapshot.observedAt || receipt.record?.days.length !== days.length ||
      days.some((day, index) => day.date !== receipt.record.days[index].date || day.registered !== receipt.record.days[index].registered)) {
    throw Error("account_registration_readback_mismatch");
  }
  const start = days[0].date, end = days.at(-1).date;
  url.search = new URLSearchParams({ start, end }).toString();
  const { registrations } = await request();
  if (registrations.start !== start || registrations.end !== end || registrations.timezone !== "UTC") {
    throw Error("account_registration_period_mismatch");
  }
  console.log(JSON.stringify({ id: receipt.id, stored: true, importedDays: days.length, period: registrations }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
