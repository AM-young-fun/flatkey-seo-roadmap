const {test}=require('node:test'),assert=require('node:assert/strict');
const {registrationReportWindows}=require('../scripts/collect-seo-registration-periods.cjs');
const has=(rows,start,end)=>rows.some(row=>row.start===start&&row.end===end);

test('first Thursday registration draft uses the LA Thursday anchor before any report is archived',()=>{
  const rows=registrationReportWindows('2026-11-19','2026-11-16');
  assert.ok(has(rows,'2026-11-12','2026-11-16'));
  assert.ok(has(rows,'2026-11-05','2026-11-09'));
  assert.equal(rows.some(row=>row.start==='2026-11-13'),false);
  assert.ok(rows.every(row=>row.end<='2026-11-16'));
});
test('Friday revisions refresh the same Thursday-start registration range without an archive',()=>{
  const rows=registrationReportWindows('2026-11-20','2026-11-17');
  assert.ok(has(rows,'2026-11-12','2026-11-17'));
  assert.ok(has(rows,'2026-11-05','2026-11-10'));
  assert.equal(rows.some(row=>row.start==='2026-11-13'),false);
});
test('a new Friday archive and Thursday archive deduplicate into the same mature two weeks',()=>{
  const rows=registrationReportWindows('2026-11-22','2026-11-19',{weekly:['2026-11-19','2026-11-20']});
  assert.equal(rows.filter(row=>row.start==='2026-11-12'&&row.end==='2026-11-18').length,1);
  assert.equal(rows.filter(row=>row.start==='2026-11-05'&&row.end==='2026-11-11').length,1);
  assert.ok(has(rows,'2026-11-19','2026-11-19'));
  assert.ok(rows.every(row=>row.end<='2026-11-19'));
});
test('historical Friday archives and pre-switch next-Friday collection retain their dates',()=>{
  const rows=registrationReportWindows('2026-11-11','2026-11-08',{weekly:['2026-11-06']});
  assert.ok(has(rows,'2026-10-30','2026-11-05'));
  assert.ok(has(rows,'2026-11-06','2026-11-08'));
  assert.ok(has(rows,'2026-10-30','2026-11-01'));
});

test('latest closed day covers the complete Thursday week and independent previous week',()=>{
 const rows=registrationReportWindows('2026-11-19','2026-11-18');
 assert.ok(has(rows,'2026-11-18','2026-11-18'));
 assert.ok(has(rows,'2026-11-17','2026-11-17'));
 assert.ok(has(rows,'2026-11-12','2026-11-18'));
 assert.ok(has(rows,'2026-11-05','2026-11-11'));
 assert.ok(rows.every(row=>row.end<='2026-11-18'));
});

test('overview 7/30/90-day presets collect independent exact current and previous periods',()=>{
 const rows=registrationReportWindows('2026-11-19','2026-11-18');
 for(const days of [7,30,90]){
  const shift=n=>new Date(Date.parse('2026-11-18T00:00:00Z')+n*86400000).toISOString().slice(0,10);
  assert.ok(has(rows,shift(1-days),'2026-11-18'));
  assert.ok(has(rows,shift(1-2*days),shift(-days)));
 }
});
