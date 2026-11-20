const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), Module = require('node:module'), ts = require('typescript');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const crypto = require('node:crypto');
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name.endsWith('.module.css')) return new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) });
  return originalLoad.call(this, name, ...args);
};
require.extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, file);
const { ReviewedReportBody } = require('../src/components/ReviewedReportBody.tsx');
const render = text => renderToStaticMarkup(React.createElement(ReviewedReportBody, { text }));
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

test('the approved six-section format renders tables, section titles, emphasis, lists and inline code without changing its source', () => {
  const sections = ['一、业务与搜索表现', '二、各站与主要市场', '三、本周交付与页面效果', '四、独立渠道结果', '五、关键词、收录与技术观察', '六、下周安排与复盘'];
  const text = '**Fixture weekly report**\n\n' + sections.map((section, i) => `**${section}**\n\n| 指标 | 上期 | 本期 |\n|---|---:|---:|\n| 页面 ${i + 1} | 101 | **202** |\n\n- 已核实 **3篇**\n\n1. 复查 \`/compute\`\n`).join('\n');
  const before = hash(text), html = render(text);
  assert.equal((html.match(/<table>/g) || []).length, 6);
  assert.equal((html.match(/<h3>/g) || []).length, 6);
  assert.equal((html.match(/role="region"/g) || []).length, 6);
  assert.match(html, /<strong>202<\/strong>/);
  assert.match(html, /<th[^>]*scope="col"/);
  assert.match(html, /<ul>[\s\S]*<li>/); assert.match(html, /<ol>[\s\S]*<li>/);
  assert.match(html, /<code>\/compute<\/code>/);
  assert.doesNotMatch(html, /\*\*|\|---|white-space:pre-wrap/);
  for (let i = 1; i < sections.length; i++) assert.ok(html.indexOf(sections[i - 1]) < html.indexOf(sections[i]));
  assert.equal(hash(text), before); assert.ok(text.endsWith('\n'));
});

test('GFM preserves right alignment, escaped pipes and HTTPS evidence links inside table cells', () => {
  const html = render('| 页面 | 访问 |\n|---|---:|\n| [A\\|B](https://flatkey.ai/zh/blog/gemini-api-pricing) | **123** |\n');
  assert.match(html, /<a href="https:\/\/flatkey.ai\/zh\/blog\/gemini-api-pricing" target="_blank" rel="noopener noreferrer">A\|B<\/a>/);
  assert.match(html, /text-align:right|align="right"/);
  assert.equal((html.match(/<td/g) || []).length, 2);
});

test('raw HTML and remote image markup cannot create scripts, event handlers, frames or tracking requests', () => {
  const html = render('<script>alert(1)</script>\n\n<img src="https://example.com/pixel" onerror="alert(1)">\n\n<svg onload="alert(1)"></svg>\n\n<iframe src="https://example.com"></iframe>\n\n![Evidence alt](https://example.com/tracker.png)\n\n安全正文');
  assert.doesNotMatch(html, /<script|<img|<svg|<iframe|onerror=|onload=|tracker.png|example.com/);
  assert.match(html, /Evidence alt/); assert.match(html, /安全正文/);
});

test('unsafe link protocols are removed while readable labels and same-site paths remain', () => {
  const html = render('[js](javascript:alert%281%29) [data](data:text/html,test) [vb](vbscript:msgbox) [mixed](JaVaScRiPt:test) [escaped](java&#x73;cript:test) [relative](/reports?period=weekly) [fragment](#summary) [network](//example.com)');
  assert.doesNotMatch(html, /href="(?:javascript|data|vbscript|\/\/)/i);
  assert.match(html, /href="\/reports\?period=weekly"/);
  assert.match(html, /href="#summary"/);
  for (const label of ['js', 'data', 'vb', 'mixed', 'escaped', 'network']) assert.ok(html.includes(label));
});

test('literal HTML in a fenced code sample remains code rather than an executable element', () => {
  const html = render('```html\n<script>alert("sample")</script>\n```\n');
  assert.match(html, /<pre><code/); assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
