const shift=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const keys=['gpu_compute','model_list','model_detail','prompts'];
function verifyDailySendReadiness(report,daily,pages,end) {
 const fresh=p=>p.date<=end&&p.date>=shift(end,-7);
 const acquisition=daily?.points?.filter(p=>fresh(p)&&p.newUsers!==null&&p.newRegistrations!==null).sort((a,b)=>b.date.localeCompare(a.date))[0];
 if(!acquisition)throw Error('daily_send_blocked_acquisition');
 if(report.accountRegistrations?.users==null||report.accountRegistrations.missing?.length)throw Error('daily_send_blocked_account_registrations');
 for(const key of keys){const points=pages?.groups?.find(g=>g.key===key)?.points??[];
  if(!points.some(p=>fresh(p)&&p.totalUsers!==null&&p.pageViews!==null)||!points.some(p=>fresh(p)&&p.funnel))throw Error('daily_send_blocked_page_group_'+key);
 }
 if(!report.text.includes('获客/注册截至 '+acquisition.date)||!report.text.includes('最近已核实页面组 4/4'))throw Error('daily_send_blocked_snapshot_sources');
 return {acquisitionDate:acquisition.date,pageGroups:4};
}
module.exports={verifyDailySendReadiness};
