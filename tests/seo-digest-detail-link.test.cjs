const test = require('node:test');
const assert = require('node:assert/strict');
const { actionCardPayload, reportDetailUrl, messageHash } = require('../src/lib/seo-digest-message.cjs');
test('daily and weekly cards link to the exact immutable saved report', () => {
 for (const kind of ['daily','weekly']) {
  const report={kind,date:'2026-11-13',id:'seo-digest:2026-11-13:0123456789abcdef',title:'report',text:'body'};
  const payload=actionCardPayload(report),url=new URL(payload.actionCard.singleURL);
  assert.equal(url.origin,'https://flatkey-seo-roadmap.vercel.app');assert.equal(url.pathname,'/reports');
  assert.equal(url.searchParams.get('period'),kind);assert.equal(url.searchParams.get('date'),report.date);assert.equal(url.searchParams.get('reportId'),report.id);
  assert.notEqual(messageHash(payload),messageHash(actionCardPayload({...report,id:'seo-digest:2026-11-13:abcdef0123456789'})));
 }
});
test('legacy or malformed values cannot redirect outside report details',()=>{
 assert.equal(reportDetailUrl({}),'https://flatkey-seo-roadmap.vercel.app/reports');
 for(const date of ['2026-02-31','2026-13-01','https://evil.test']) {
  const url=new URL(reportDetailUrl({kind:'https://evil.test',date,id:'//evil.test'}));
  assert.equal(url.origin,'https://flatkey-seo-roadmap.vercel.app');assert.equal(url.search,'');
 }
 assert.equal(new URL(reportDetailUrl({date:'2026-11-13',id:'seo-digest:2026-11-12:0123456789abcdef'})).searchParams.has('reportId'),false);
});
