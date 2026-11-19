const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const root = path.resolve(__dirname, ".."), load = Module._load;
const body = "**已审完整周报**\n\n业务与搜索表现：注册78人。\n\n<script>not executable</script>";
const report = { id: "seo-digest:2026-11-19:0123456789abcdef", date: "2026-11-19", kind: "weekly", title: "已审完整周报", generatedAt: "2026-11-19T11:00:00Z",
  text: body, detailText: body, reviewedBody: { version: 1, recordOnly: true },
  counts: { originals: 999123, landingPages: 999123, optimizedPages: 999123 }, coverage: {},
  organicRegistrations: { current: 999123 }, registrationCoverageNote: "stale registration coverage", registrationCorrection: true };
Module._load = function (name, parent, ...rest) {
  if (name === "next/navigation") return { useSearchParams: () => new URLSearchParams("period=weekly&date=2026-11-19"), useRouter: () => ({ push() {} }) };
  if (name === "next/link") return { __esModule: true, default: props => React.createElement("a", { href: props.href }, props.children) };
  if (name === "./useSeoAnalytics") return { numberText: String, shanghaiStamp: String, useSeoRead: () => ({ data: { report, dates: [report.date] }, retry() {} }) };
  if (name === "./UiSelect") return { UiSelect: () => null };
  if (name === "./ReportLoading") return { ReportLoading: () => null };
  if (name.endsWith(".module.css")) return new Proxy({}, { get: (_, property) => property === "__esModule" ? false : String(property) });
  return load.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest);
};
for (const ext of [".ts", ".tsx"]) require.extensions[ext] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, file);
const { SeoDigestReports } = require("../src/components/SeoDigestReports.tsx");
test("reviewed snapshots show the exact safe body without stale structured metrics or dynamic correction text", () => {
  const html = renderToStaticMarkup(React.createElement(SeoDigestReports));
  assert.match(html, /已审周报完整正文/); assert.match(html, /注册78人/);
  assert.match(html, /&lt;script&gt;not executable&lt;\/script&gt;/);
  assert.doesNotMatch(html, /999123|stale registration coverage|事后修订|待审页面版本|SEO 注册人数/);
});
