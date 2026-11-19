// Dedicated first-acquisition registration evidence. Never sums daily users.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const Module = require('node:module'), ts = require('typescript');
// Reuse the web report calendar without installing a process-wide TS loader.
const calendarPath = path.join(__dirname, '../src/lib/seo-date-range.ts');
const calendarModule = new Module(calendarPath, module);
calendarModule.filename = calendarPath; calendarModule.paths = module.paths;
calendarModule._compile(ts.transpileModule(fs.readFileSync(calendarPath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, calendarPath);
const { weeklyReportRange, WEEKLY_REPORT_SWITCH_DATE } = calendarModule.exports;
const origin = process.env.SEO_PLATFORM_ORIGIN || 'https://flatkey-seo-roadmap.vercel.app';
const shift = (d,n) => new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);

function registrationReportWindows(beijingToday, eligibleEnd, archive = {}) {
  const windows = new Map();
  const add = (start,end) => { if (start <= end && end <= eligibleEnd) windows.set(start + ':' + end, {start,end}); };
  const addReport = (date,kind) => {
    const {start,end} = kind === 'weekly' ? weeklyReportRange(date) : {start:shift(date,-1),end:shift(date,-1)};
    const closed = [end,eligibleEnd].sort()[0];
    if (start > closed) return;
    const offset = kind === 'weekly' ? -7 : -1;
    add(start,closed); add(shift(start,offset),shift(closed,offset));
  };
  for (const kind of ['daily','weekly']) for (const date of archive[kind] ?? []) addReport(date,kind);
  addReport(beijingToday,'daily');
  const weekday = new Date(beijingToday + 'T00:00:00Z').getUTCDay();
  const newCalendar = beijingToday >= WEEKLY_REPORT_SWITCH_DATE;
  // Refresh the closing LA report even before its first archive exists, and
  // retain the early partial-window collection for the next preparation day.
  if (newCalendar) addReport(beijingToday,'weekly');
  addReport(shift(beijingToday,((newCalendar ? 4 : 5)-weekday+7)%7),'weekly');
  // Overview presets use independent whole-period deduplication, just like reports.
  for (const days of [7, 30, 90]) {
    add(shift(eligibleEnd, 1-days), eligibleEnd);
    add(shift(eligibleEnd, 1-2*days), shift(eligibleEnd, -days));
  }
  add(eligibleEnd,eligibleEnd); add(shift(eligibleEnd,-1),shift(eligibleEnd,-1));
  return [...windows.values()];
}

async function main() {
  const importing = process.argv.includes('--import'), token = process.env.SEO_IMPORT_TOKEN;
  assert.ok(token, 'missing_import_token');
  const output = path.resolve(process.env.SEO_REGISTRATION_OUTPUT_DIR || '.local/seo-registration-periods',new Date().toISOString().replace(/[:.]/g,'-'));
  fs.mkdirSync(output,{recursive:true,mode:0o700});
  const save = (name,data) => fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify(data,null,2)+'\n',{mode:0o600});
  const request = async (url,options={}) => {
    const r=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(60000)});
    if(!r.ok)throw Error('http_'+r.status+'_'+new URL(url).pathname);
    return r.json();
  };
  const platformHeaders={authorization:'Bearer '+token,'content-type':'application/json'};
  const credential=JSON.parse(process.env.SEO_GOOGLE_SERVICE_ACCOUNT_JSON || fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS,'utf8'));
  const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),iat=Math.floor(Date.now()/1000);
  const unsigned=enc({alg:'RS256',typ:'JWT'})+'.'+enc({iss:credential.client_email,scope:'https://www.googleapis.com/auth/analytics.readonly',aud:'https://oauth2.googleapis.com/token',iat,exp:iat+3600});
  const auth=await request('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+crypto.sign('RSA-SHA256',Buffer.from(unsigned),credential.private_key).toString('base64url')})});
  assert.ok(auth.access_token);
  const googleHeaders={authorization:'Bearer '+auth.access_token,'content-type':'application/json'};
  const p=await request('https://analyticsadmin.googleapis.com/v1beta/properties/541304395',{headers:googleHeaders});
  const s=await request('https://analyticsadmin.googleapis.com/v1beta/properties/541304395/dataStreams',{headers:googleHeaders});
  assert.equal(p.timeZone,'America/Los_Angeles');assert.equal(s.dataStreams.length,1);
  assert.equal(s.dataStreams[0].name,'properties/541304395/dataStreams/15056169010');
  assert.equal(s.dataStreams[0].webStreamData.measurementId,'G-30RCEP2CVH');assert.equal(s.dataStreams[0].webStreamData.defaultUri,'https://flatkey.ai');
  save('property',{property:p,streams:s});
  const propertyToday=new Intl.DateTimeFormat('en-CA',{timeZone:p.timeZone}).format(new Date()),eligibleEnd=shift(propertyToday,-1);
  const beijingToday=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());
  const archive={};
  for(const kind of ['daily','weekly']){
    const result=await request(origin+'/api/seo/digest?'+new URLSearchParams({kind,saved:'1',archive:'1'}),{headers:platformHeaders});
    archive[kind]=result.dates??[];
  }
  const windows=registrationReportWindows(beijingToday,eligibleEnd,archive);
  save('manifest',{archive,eligibleEnd,windows,policy:'Latest closed LA day; quality-checked current values may be revised; partial weeks compare matching covered dates'});
  const receipts=[],missing=[];
  for(const {start,end} of windows){
    const query={dateRanges:[{startDate:start,endDate:end}],metrics:[{name:'totalUsers'},{name:'eventCount'}],dimensionFilter:{andGroup:{expressions:[['firstUserPrimaryChannelGroup','Organic Search'],['eventName','sign_up_success']].map(([fieldName,value])=>({filter:{fieldName,stringFilter:{matchType:'EXACT',value,caseSensitive:true}}}))}},limit:'1'};
    const result=await request('https://analyticsdata.googleapis.com/v1beta/properties/541304395:runReport',{method:'POST',headers:googleHeaders,body:JSON.stringify(query)});
    save(start+'_'+end+'-source',{query,result});
    const m=result.metadata;assert.equal(m?.timeZone,p.timeZone);
    assert.ok(!m.subjectToThresholding&&!m.dataLossFromOtherRow&&!m.emptyReason&&!m.dataTruncationReasons?.length&&!m.schemaRestrictionResponse?.activeMetricRestrictions?.length&&!m.samplingMetadatas?.some(v=>v.samplesReadCount!==v.samplingSpaceSize),'source_quality_incomplete');
    assert.deepEqual(result.metricHeaders.map(x=>x.name),['totalUsers','eventCount']);
    if(!result.rows?.length){missing.push({start,end,reason:'no_explicit_aggregate_row'});continue;}
    assert.equal(result.rows.length,1);assert.equal(result.rowCount,1);
    const metrics=result.rows[0].metricValues.map(x=>{assert.match(x.value,/^\d+$/);return Number(x.value);});
    assert.ok(metrics.every(Number.isSafeInteger));assert.ok(metrics[0]<=metrics[1]);
    const record={version:1,siteDomain:'flatkey.ai',propertyId:'541304395',streamId:'15056169010',measurementId:'G-30RCEP2CVH',source:'google-api',timezone:p.timeZone,channelDimension:'firstUserPrimaryChannelGroup',channelName:'Organic Search',event:'sign_up_success',metric:'totalUsers',distinctOverWholePeriod:true,start,end,observedAt:new Date().toISOString(),users:metrics[0],events:metrics[1],sources:['https://analytics.google.com/analytics/web/#/a248149353p541304395/admin/events/hub']};
    save(start+'_'+end+'-payload',record);
    if(importing){
      const receipt=await request(origin+'/api/traffic/registrations',{method:'POST',headers:platformHeaders,body:JSON.stringify(record)});
      assert.equal(receipt.stored,true);assert.deepEqual(receipt.record,record);
      const readback=await request(origin+'/api/traffic/registrations?'+new URLSearchParams({start,end}),{headers:platformHeaders});
      assert.ok(readback.records.some(row=>JSON.stringify(row)===JSON.stringify(record)),'period_readback_mismatch');
      save(start+'_'+end+'-receipt',receipt);receipts.push({start,end,users:record.users,id:receipt.id});
    }else receipts.push({start,end,users:record.users});
  }
  const summary={verifiedAt:new Date().toISOString(),mode:importing?'import':'dry-run',eligibleEnd,receipts,missing,output};save('summary',summary);console.log(JSON.stringify(summary));
}
module.exports = { registrationReportWindows };
if (require.main === module) main().catch(error=>{console.error(error.message);process.exitCode=1;});
