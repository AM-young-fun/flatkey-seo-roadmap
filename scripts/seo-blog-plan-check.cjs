#!/usr/bin/env node
// Read-only coverage gate shared by candidate planning, finalization and dispatch.
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const SITE = 'modelfit.cc';
const localDay = value => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai'}).format(new Date(value));
const normalize = value => (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const shiftDay = (day, offset) => new Date(Date.parse(day+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
const validDay = day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)
  && Number.isFinite(Date.parse(day+'T00:00:00Z')) && shiftDay(day,0) === day;
const mondayForDay = day => shiftDay(day,-((new Date(day+'T00:00:00Z').getUTCDay()+6)%7));
function calendarWindow(calendar) {
  if (calendar?.range !== undefined) {
    const {start,end} = calendar.range || {};
    if (!validDay(start) || !validDay(end) || new Date(start+'T00:00:00Z').getUTCDay() !== 5 || end !== shiftDay(start,6)) throw Error('calendar_range_invalid');
    // A business range is a read window, never a Friday production weekStart.
    if (calendar.weekStart !== undefined && (!validDay(calendar.weekStart) || mondayForDay(calendar.weekStart) !== calendar.weekStart)) throw Error('calendar_week_invalid');
    return {start,end};
  }
  const week = calendar?.weekStart;
  if (!validDay(week) || mondayForDay(week) !== week) throw Error('calendar_week_invalid');
  return {start:week,end:shiftDay(week,6)};
}
function calendarPlanWeeks(calendar) {
  const range = calendarWindow(calendar);
  return [...new Set([mondayForDay(range.start),mondayForDay(range.end)])];
}
function calendarDays(calendar) {
  const {start,end} = calendarWindow(calendar);
  if (!Array.isArray(calendar.workdays) || !calendar.evidence?.sourceUrl?.startsWith('https://') || !Number.isFinite(Date.parse(calendar.evidence.checkedAt))) throw Error('verified_workday_calendar_required');
  if (new Set(calendar.workdays).size !== calendar.workdays.length || calendar.workdays.some(day => !validDay(day) || day < start || day > end)) throw Error('calendar_days_invalid');
  return [...calendar.workdays].sort();
}
function checkBusinessPlan(snapshots, calendar, from, stage) {
  const dates = calendarDays(calendar).filter(day => !from || day >= from);
  const range = calendarWindow(calendar), planWeeks = calendarPlanWeeks(calendar);
  const errors = [], byWeek = new Map(), byId = new Map();
  if (!Array.isArray(snapshots)) throw Error('business_snapshots_array_required');
  for (const snapshot of snapshots) {
    if (snapshot.storage !== 'database') errors.push({code:'production_database_required'});
    const week = snapshot.weekStart ?? snapshot.plan?.weekStart;
    if (!planWeeks.includes(week)) { errors.push({code:'unexpected_plan_week',weekStart:week ?? null}); continue; }
    if (byWeek.has(week)) { errors.push({code:'duplicate_plan_snapshot',weekStart:week}); continue; }
    byWeek.set(week,snapshot);
    if (snapshot.plan && snapshot.plan.weekStart !== week) errors.push({code:'plan_snapshot_week_mismatch',weekStart:week});
    for (const task of snapshot.tasks || []) {
      if (task.deletedAt || task.siteDomain !== SITE || task.kind !== 'blog') continue;
      let day;
      try { day = localDay(task.dueAt); } catch { errors.push({code:'invalid_task_due_at',taskId:task.id}); continue; }
      // Other days in either Monday bucket belong to another business week.
      if (day < range.start || day > range.end) continue;
      if (byId.has(task.id)) {
        if (!isDeepStrictEqual(byId.get(task.id),task)) errors.push({code:'conflicting_task_snapshot',taskId:task.id});
      } else byId.set(task.id,task);
    }
  }
  const plans = planWeeks.map(week => {
    const plan = byWeek.get(week)?.plan;
    if (!plan || plan.weekStart !== week || !(stage === 'candidate' ? ['draft','scheduled','reviewed'] : ['scheduled','reviewed']).includes(plan.status)) errors.push({code:'formal_plan_required',weekStart:week});
    return {weekStart:week,planId:plan?.id || null,planStatus:plan?.status || null,planVersion:plan?.version || null};
  });
  const idsForDay = day => new Set(byWeek.get(mondayForDay(day))?.plan?.taskIds || []);
  const tasks = [...byId.values()];
  const inPlan = tasks.filter(task => idsForDay(localDay(task.dueAt)).has(task.id));
  const seen = {url:new Map(),keyword:new Map()};
  for (const task of tasks) {
    if (task.weekStart !== mondayForDay(localDay(task.dueAt))) errors.push({code:'task_week_mismatch',taskId:task.id});
  }
  for (const task of inPlan) {
    if (task.country !== 'US' || task.language !== 'en') errors.push({code:'wrong_market_or_language',taskId:task.id});
    if (!calendar.workdays.includes(localDay(task.dueAt))) errors.push({code:'non_workday_task',taskId:task.id});
    for (const [field,value] of [['url',task.pageUrl?.replace(/\/$/, '')],['keyword',normalize(task.keyword)]]) {
      if (value && seen[field].has(value)) errors.push({code:'duplicate_'+field,taskIds:[seen[field].get(value),task.id]});
      if (value) seen[field].set(value,task.id);
    }
  }
  const days = dates.map(date => {
    const weekStart = mondayForDay(date), plan = byWeek.get(weekStart)?.plan;
    const scheduled = inPlan.filter(task => localDay(task.dueAt) === date);
    const unplanned = tasks.filter(task => !idsForDay(date).has(task.id) && localDay(task.dueAt) === date);
    const gaps = (plan?.gaps || []).filter(g => g.category === 'other' && g.count === 1 && g.reason.startsWith(`[ModelFit US/en ${date}] `) && g.reason.length > 36);
    if (scheduled.length > 1) errors.push({code:'daily_quota_exceeded',date,taskIds:scheduled.map(task=>task.id)});
    if (unplanned.length) errors.push({code:'existing_task_not_in_plan',date,taskIds:unplanned.map(task=>task.id)});
    if (scheduled.length === 0 && gaps.length !== 1) errors.push({code:'missing_daily_slot',date});
    if (scheduled.length && gaps.length) errors.push({code:'stale_gap',date});
    const task = scheduled[0];
    if (task && (!task.keywordId || !task.keyword || !/^https:\/\/modelfit\.cc\/blog\/[a-z0-9-]+$/.test(task.pageUrl || '') || !task.evidence?.length || !task.research?.evidence?.length || !task.nextAction)) errors.push({code:'task_inputs_incomplete',date,taskId:task.id});
    if (task && ['planned','researching'].includes(task.status)) errors.push({code:'research_not_ready',date,taskId:task.id});
    if (task && ['blocked','failed'].includes(task.status)) errors.push({code:'original_task_needs_repair',date,taskId:task.id});
    return {date,weekStart,taskId:task?.id || null,status:task?.status || (gaps.length === 1 ? 'declared_gap':'missing'),gap:gaps[0]?.reason || null};
  });
  return {siteDomain:SITE,range,planWeeks,plans,stage,expected:dates.length,scheduled:days.filter(day=>day.taskId).length,gaps:days.filter(day=>day.status==='declared_gap').length,ok:errors.length===0 && days.every(day=>day.taskId),accountedFor:errors.length===0,days,errors};
}
function checkPlan(snapshot, calendar, from, stage = 'scheduled') {
  if (!['candidate','scheduled'].includes(stage)) throw Error('stage_invalid');
  const range = calendarWindow(calendar);
  if (from && (!validDay(from) || from < range.start || from > range.end)) throw Error('from_outside_week');
  if (calendar.range !== undefined) return checkBusinessPlan(snapshot,calendar,from,stage);
  const dates = calendarDays(calendar).filter(day => !from || day >= from);
  const plan = snapshot.plan;
  const errors = [];
  if (snapshot.storage !== 'database') errors.push({code:'production_database_required'});
  if (!plan || plan.weekStart !== calendar.weekStart || !(stage === 'candidate' ? ['draft','scheduled','reviewed'] : ['scheduled','reviewed']).includes(plan.status)) errors.push({code:'formal_plan_required'});
  const ids = new Set(plan?.taskIds || []);
  const tasks = (snapshot.tasks || []).filter(t => !t.deletedAt && t.siteDomain === SITE && t.kind === 'blog' && t.weekStart === calendar.weekStart);
  const inPlan = tasks.filter(t => ids.has(t.id));
  const seen = {url:new Map(),keyword:new Map()};
  for (const task of inPlan) {
    if (task.country !== 'US' || task.language !== 'en') errors.push({code:'wrong_market_or_language',taskId:task.id});
    if (!calendar.workdays.includes(localDay(task.dueAt))) errors.push({code:'non_workday_task',taskId:task.id});
    for (const [field,value] of [['url',task.pageUrl?.replace(/\/$/, '')],['keyword',normalize(task.keyword)]]) {
      if (value && seen[field].has(value)) errors.push({code:'duplicate_'+field,taskIds:[seen[field].get(value),task.id]});
      if (value) seen[field].set(value,task.id);
    }
  }
  const days = dates.map(date => {
    // Existing failed/blocked/in-progress tasks occupy their ORIGINAL date;
    // repair the original task rather than replacing it or counting a retry twice.
    const scheduled = inPlan.filter(t => localDay(t.dueAt) === date);
    const unplanned = tasks.filter(t => !ids.has(t.id) && localDay(t.dueAt) === date);
    const gaps = (plan?.gaps || []).filter(g => g.category === 'other' && g.count === 1 && g.reason.startsWith(`[ModelFit US/en ${date}] `) && g.reason.length > 36);
    if (scheduled.length > 1) errors.push({code:'daily_quota_exceeded',date,taskIds:scheduled.map(t=>t.id)});
    if (unplanned.length) errors.push({code:'existing_task_not_in_plan',date,taskIds:unplanned.map(t=>t.id)});
    if (scheduled.length === 0 && gaps.length !== 1) errors.push({code:'missing_daily_slot',date});
    if (scheduled.length && gaps.length) errors.push({code:'stale_gap',date});
    const task = scheduled[0];
    if (task && (!task.keywordId || !task.keyword || !/^https:\/\/modelfit\.cc\/blog\/[a-z0-9-]+$/.test(task.pageUrl || '') || !task.evidence?.length || !task.research?.evidence?.length || !task.nextAction)) errors.push({code:'task_inputs_incomplete',date,taskId:task.id});
    if (task && ['planned','researching'].includes(task.status)) errors.push({code:'research_not_ready',date,taskId:task.id});
    if (task && ['blocked','failed'].includes(task.status)) errors.push({code:'original_task_needs_repair',date,taskId:task.id});
    return {date,taskId:task?.id || null,status:task?.status || (gaps.length === 1 ? 'declared_gap':'missing'),gap:gaps[0]?.reason || null};
  });
  return {siteDomain:SITE,weekStart:calendar.weekStart,stage,planId:plan?.id || null,planStatus:plan?.status || null,planVersion:plan?.version || null,expected:dates.length,scheduled:days.filter(d=>d.taskId).length,gaps:days.filter(d=>d.status==='declared_gap').length,ok:errors.length===0 && days.every(d=>d.taskId),accountedFor:errors.length===0,days,errors};
}
async function readSnapshot(week, settingsFile) {
  let token=process.env.SEO_IMPORT_TOKEN?.trim();
  if (!token) {
    const config=JSON.parse(fs.readFileSync(settingsFile,'utf8'));
    const stat=fs.lstatSync(config.tokenFile);
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.mode & 0o077) throw Error('insecure_token_file');
    token=fs.readFileSync(config.tokenFile,'utf8').trim();
  }
  const r=await fetch('https://flatkey-seo-roadmap.vercel.app/api/seo/workflow?week='+encodeURIComponent(week),{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(30000)});
  if (!r.ok) throw Error('workflow_http_'+r.status);
  return r.json();
}
async function readCalendarSnapshots(calendar, settingsFile) {
  calendarDays(calendar);
  return calendar.range !== undefined
    ? Promise.all(calendarPlanWeeks(calendar).map(week=>readSnapshot(week,settingsFile)))
    : readSnapshot(calendar.weekStart,settingsFile);
}
async function main() {
  const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const i=arg.indexOf('=');if(i<0)throw Error('use_named_arguments');return [arg.slice(2,i),arg.slice(i+1)];}));
  if (!args.calendar) throw Error('calendar_argument_required');
  const calendar=JSON.parse(fs.readFileSync(args.calendar,'utf8'));calendarDays(calendar);
  const range=calendarWindow(calendar);
  if (args.from && (!validDay(args.from) || args.from < range.start || args.from > range.end)) throw Error('from_outside_week');
  const settings=args.settings || path.resolve('.local/seo-codex-progress/settings.json');
  const snapshot=args.snapshot ? JSON.parse(fs.readFileSync(args.snapshot,'utf8')) : await readCalendarSnapshots(calendar,settings);
  const result={checkedAt:new Date().toISOString(),...checkPlan(snapshot,calendar,args.from,args.stage || 'scheduled')};
  if(args.out)fs.writeFileSync(args.out,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));process.exitCode=result.ok?0:result.accountedFor?3:2;
}
module.exports={calendarDays,calendarWindow,calendarPlanWeeks,checkPlan,readSnapshot,readCalendarSnapshots};
if(require.main===module) main().catch(error=>{console.error(JSON.stringify({ok:false,code:error.message}));process.exitCode=1;});
