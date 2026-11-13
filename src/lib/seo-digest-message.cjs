/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports -- Shared with the dependency-free GitHub Actions sender. */
const { createHash } = require('node:crypto');
const DETAIL_URL = 'https://flatkey-seo-roadmap.vercel.app/reports';
function reportDetailUrl(report) {
 const url = new URL(DETAIL_URL);
 if (report?.kind === 'daily' || report?.kind === 'weekly') url.searchParams.set('period', report.kind);
 if (typeof report?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(report.date) && Number.isFinite(Date.parse(report.date + 'T00:00:00Z')) && new Date(report.date + 'T00:00:00Z').toISOString().slice(0, 10) === report.date) {
  url.searchParams.set('date', report.date);
  if (typeof report.id === 'string' && new RegExp('^seo-digest:' + report.date + ':[a-f0-9]{16}$').test(report.id)) url.searchParams.set('reportId', report.id);
 }
 return url.href;
}
function actionCardPayload(report) {
 if (!report || typeof report.title !== 'string' || typeof report.text !== 'string') throw Error('invalid_report_message');
 return { msgtype: 'actionCard', actionCard: { title: report.title, text: report.text, btnOrientation: '0', singleTitle: '查看详情', singleURL: reportDetailUrl(report) } };
}
const messageHash = payload => createHash('sha256').update(JSON.stringify(payload)).digest('hex');
function digestSnapshotId(report) {
 const { date, text, detailText, pagePerformance, recentPages, deliveryStates, organicRegistrations } = report;
 const version = createHash('sha256').update(JSON.stringify({ text, detailText, pagePerformance, recentPages, deliveryStates, organicRegistrations })).digest('hex').slice(0, 16);
 return `seo-digest:${date}:${version}`;
}
module.exports = { actionCardPayload, digestSnapshotId, messageHash, reportDetailUrl, DETAIL_URL };
