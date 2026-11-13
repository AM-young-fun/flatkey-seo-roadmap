const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const {parseConfig,acceptedReceipt}=require('../scripts/server-seo-digest-send.cjs');
const original=Module._load;Module._load=function(name,...args){return name==='server-only'?{}:original.call(this,name,...args)};
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {webhookReceiptSchema}=require('../src/lib/seo-webhook-receipt.ts');
const secret={webhook:'https://oapi.dingtalk.com/robot/send?access_token=fixture-token',secret:'fixture-signing-secret'};
test('webhook config permits only the known HTTPS endpoint and does not expose credentials in errors',()=>{
 const good=parseConfig(JSON.stringify(secret));assert.match(good.fingerprint,/^[a-f0-9]{64}$/);
 assert.notEqual(parseConfig(JSON.stringify({...secret,secret:'rotated-fixture'})).fingerprint,good.fingerprint);
 for(const input of ['bad',JSON.stringify({...secret,webhook:'https://evil.test/robot/send?access_token=fixture-token'}),JSON.stringify({...secret,webhook:'https://user:password@oapi.dingtalk.com/robot/send?access_token=fixture-token'}),JSON.stringify({...secret,webhook:secret.webhook+'&redirect=https://evil.test'}),JSON.stringify({...secret,secret:''})]) assert.throws(()=>parseConfig(input),error=>error.message==='invalid_webhook_configuration');
});
test('accepted webhook receipts preserve actual errcode success without fabricating a processQueryKey',()=>{
 const config=parseConfig(JSON.stringify(secret));const receipt=acceptedReceipt(new Response('',{status:200,headers:{'x-acs-request-id':'fixture-trace'}}),'{"errcode":0,"errmsg":"ok"}',config,'123',new Date('2026-11-11T10:40:00Z'));
 assert.equal(webhookReceiptSchema.safeParse(receipt).success,true);assert.equal(receipt.errcode,0);assert.equal(receipt.transport,'signed-webhook');assert.equal('processQueryKey' in receipt,false);assert.equal(JSON.stringify(receipt).includes('fixture-token'),false);
 for(const [status,body] of [[200,'{"errcode":310000}'],[500,'{"errcode":0}'],[200,'{}'],[200,'bad']]) assert.throws(()=>acceptedReceipt(new Response('',{status}),body,config,'123'));
 assert.equal(webhookReceiptSchema.safeParse({...receipt,errcode:1}).success,false);assert.equal(webhookReceiptSchema.safeParse({...receipt,processQueryKey:'invented'}).success,false);
});
test('send script records attempt and durable acceptance before acknowledgement and has no implicit retries',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../scripts/server-seo-digest-send.cjs'),'utf8');
 assert.ok(source.indexOf("action: 'begin'")<source.indexOf('fetch(signedWebhook'));
 assert.ok(source.indexOf("write('.accepted.json'")<source.indexOf("status: 'DELIVERED', webhookReceipt"));
 assert.match(source,/if \(!process\.argv\.includes\('--send'\)\)/);assert.match(source,/action: 'read_saved'/);assert.match(source,/webhook_control_binding_unverified/);assert.doesNotMatch(source,/processQueryKey|setInterval|while\s*\(/);
});

test('one shared ActionCard payload binds the real details button and every visible byte',()=>{
 const {actionCardPayload,messageHash,DETAIL_URL}=require('../src/lib/seo-digest-message.cjs');
 const report={title:'Flatkey SEO 日报',text:'已完成 1 项\n[数据基础](https://alidocs.dingtalk.com/i/nodes/example)'};
 const payload=actionCardPayload(report);
 assert.deepEqual(payload,{msgtype:'actionCard',actionCard:{title:report.title,text:report.text,btnOrientation:'0',singleTitle:'查看详情',singleURL:DETAIL_URL}});
 assert.equal(DETAIL_URL,'https://flatkey-seo-roadmap.vercel.app/reports');
 assert.notEqual(messageHash(payload),messageHash({...payload,actionCard:{...payload.actionCard,singleURL:DETAIL_URL+'/other'}}));
 assert.notEqual(messageHash(payload),messageHash(actionCardPayload({...report,text:report.text+' changed'})));
 const sender=fs.readFileSync(path.join(__dirname,'../scripts/server-seo-digest-send.cjs'),'utf8');
 assert.match(sender,/claim\.payloadSha256 !== payloadSha256/);assert.match(sender,/body: JSON\.stringify\(payload\)/);
 assert.match(sender,/messageFormat: 'actionCard', payloadSha256/);
});

test('sender verifies both the body and the report snapshot, including detail-only changes', () => {
 const { createHash } = require('node:crypto');
 const { digestSnapshotId } = require('../src/lib/seo-digest-message.cjs');
 const { validReportBinding } = require('../scripts/server-seo-digest-send.cjs');
 const report = { date: '2026-11-13', kind: 'daily', text: 'summary', detailText: 'details', deliveryProtocol: 2 };
 report.hash = createHash('sha256').update(report.text).digest('hex');
 report.id = digestSnapshotId(report);
 assert.equal(validReportBinding(report, report.date, report.kind), true);
 assert.equal(validReportBinding({ ...report, text: 'tampered' }, report.date, report.kind), false);
 assert.equal(validReportBinding({ ...report, detailText: 'tampered' }, report.date, report.kind), false);
});
