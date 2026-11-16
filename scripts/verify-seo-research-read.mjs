import assert from "node:assert/strict";

const origin = "https://flatkey-seo-roadmap.vercel.app";
const key = process.env.SEO_RESEARCH_READ_KEY;
assert.match(key ?? "", /^seo_research_[a-f0-9]{64}$/, "Configure the dedicated research key");

const options = { redirect: "error", signal: AbortSignal.timeout(15000) };
const headers = { "X-SEO-Research-Key": key };

for (const [path, field] of [["/api/keywords", "keywords"], ["/api/topics", "topics"]]) {
  const url = new URL(path, origin);
  const [read, anonymous, rejected] = await Promise.all([
    fetch(url, { ...options, headers }),
    fetch(url, options),
    fetch(url, { ...options, headers: { "X-SEO-Research-Key": "invalid" } }),
  ]);
  assert.equal(read.status, 200, path);
  assert.match(read.headers.get("cache-control") ?? "", /no-store/, path);
  assert.equal(anonymous.status, 401, path);
  assert.equal(rejected.status, 401, path);
  const payload = await read.json();
  assert.equal(payload.usingDemoData, false, path);
  assert.ok(Array.isArray(payload[field]), path);
  console.log(`${path}: production read verified (${payload[field].length} rows)`);
}
