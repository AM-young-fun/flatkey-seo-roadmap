/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports -- Shared with the dependency-free GitHub Actions sender. */
const { createHash } = require('node:crypto');
const DETAIL_URL = 'https://flatkey-seo-roadmap.vercel.app';
function actionCardPayload(report) {
 if (!report || typeof report.title !== 'string' || typeof report.text !== 'string') throw Error('invalid_report_message');
 return { msgtype: 'actionCard', actionCard: { title: report.title, text: report.text, btnOrientation: '0', singleTitle: '查看详情', singleURL: DETAIL_URL } };
}
const messageHash = payload => createHash('sha256').update(JSON.stringify(payload)).digest('hex');
module.exports = { actionCardPayload, messageHash, DETAIL_URL };
