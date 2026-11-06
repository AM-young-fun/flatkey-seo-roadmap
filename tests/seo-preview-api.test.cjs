const assert = require("node:assert/strict"), { test, afterEach } = require("node:test");
const fs = require("node:fs"), Module = require("node:module"), ts = require("typescript");
const originalLoad = Module._load;
Module._load = function (name, ...args) { return name === "server-only" ? {} : originalLoad.call(this, name, ...args); };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { previewRead } = require("../src/lib/seo-preview.ts");
const environment = { NODE_ENV: process.env.NODE_ENV, SEO_PREVIEW_UPSTREAM_TOKEN: process.env.SEO_PREVIEW_UPSTREAM_TOKEN };
afterEach(() => { for (const [key, value] of Object.entries(environment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

test("preview cannot proxy production requests or writes even if a preview token is configured", async t => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("No production or mutation request may use the preview credential"));
  process.env.SEO_PREVIEW_UPSTREAM_TOKEN = "fictional-preview-credential";
  process.env.NODE_ENV = "production";
  assert.equal(await previewRead(new Request("http://localhost:3104/api/traffic/daily")), null);
  process.env.NODE_ENV = "development";
  assert.equal(await previewRead(new Request("https://flatkey-seo-roadmap.vercel.app/api/traffic/daily")), null);
  assert.equal(await previewRead(new Request("http://localhost:3104/api/traffic/daily", { method: "POST" })), null);
  const crossOrigin = await previewRead(new Request("http://localhost:3104/api/traffic/daily", { headers: { origin: "https://foreign.invalid" } }));
  assert.equal(crossOrigin.status, 403);
});

test("preview reads only the fixed upstream and never exposes its bearer in the response", async t => {
  process.env.NODE_ENV = "development";
  process.env.SEO_PREVIEW_UPSTREAM_TOKEN = "fictional-preview-credential";
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://flatkey-seo-roadmap.vercel.app/api/traffic/daily?site=flatkey.ai");
    assert.equal(options.headers.Authorization, "Bearer fictional-preview-credential");
    assert.equal(options.redirect, "error");
    return Response.json({ points: [] });
  });
  const response = await previewRead(new Request("http://localhost:3104/api/traffic/daily?site=flatkey.ai"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(JSON.stringify([...response.headers]).includes("fictional-preview-credential"), false);
  assert.equal((await response.text()).includes("fictional-preview-credential"), false);
});
