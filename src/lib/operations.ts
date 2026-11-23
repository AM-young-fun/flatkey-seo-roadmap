import { isSeoWorkday } from "./seo-workday";
import { nextSerpPeriodDue, nextSerpPeriodKey, periodDue, serpPeriod, scheduledSerpDue } from "./serp-periods";
import automationConfig from "./data/seo-automation-config.json";

export const dailyAnalyticsCollectionTime = "16:00";
import { seoScheduleOpensAt } from "./seo-schedule-window";

export const schedulerCadence = "每日 10:10–23:55，每 5 分钟检查及续跑";

export type OperationsStatus = {
  checkedAt: string;
  automationConfigurationVerifiedAt: string;
  executionEvidence?: "available" | "unavailable";
  evidenceNote?: string;
  controls: { enabled: boolean; emergencyStopped: boolean; maxRunCostMicros: number; maxMonthCostMicros: number; discoveryMaxCostMicros: number };
  scheduler: { configured: boolean; cadence: string; state: "UNCONFIRMED" | "HEALTHY" | "OVERDUE" | "ERROR"; lastStartedAt: string | null; lastCompletedAt: string | null };
  plans: { id: string; name: string; location: string; cadence: string; state: string; nextAt: string | null; note: string; dependencies?: string[]; currentExecution?: string }[];
  records: { id: string; name: string; state: string; startedAt: string; completedAt: string | null; detail: string; failedDiscoveryId?: string }[];
};

export function schedulerState(last: { startedAt: Date; completedAt: Date | null; status: string } | null, now: Date): OperationsStatus["scheduler"]["state"] {
  if (!last) return "UNCONFIRMED";
  if (last.status === "FAILED" || last.status === "NEEDS_REVIEW") return "ERROR";
  const grace = 75 * 60_000;
  const opensAt = seoScheduleOpensAt(now);
  const previousLastSlot = opensAt - (10 * 60 + 15) * 60_000; // 23:55 Shanghai on the previous day.
  const expectedCheckAt = now.getTime() <= opensAt + grace ? previousLastSlot : now.getTime();
  if (last.startedAt.getTime() < expectedCheckAt - grace) return "OVERDUE";
  // A started check is not proof of a successfully completed invocation.
  return last.completedAt ? "HEALTHY" : "UNCONFIRMED";
}

export function plannedRankingTime(now: Date, stored: Date | null, startedPeriodKeys: string[] = []): string {
  if (stored) return startedPeriodKeys.includes(serpPeriod(stored).key)
    ? periodDue(nextSerpPeriodKey(serpPeriod(stored).key)).toISOString() : scheduledSerpDue(stored).toISOString();
  const current = serpPeriod(now);
  return Date.parse(current.dueAt) > now.getTime() ? current.dueAt : nextSerpPeriodDue(now).toISOString();
}

export function nextCollectorTime(now:Date,kind:"sheets"|"ahrefs"|"traffic"):string{
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai"}).format(now);
  for(let offset=0;offset<8;offset++){
    const day=new Date(Date.parse(`${today}T00:00:00Z`)+offset*86400000).toISOString().slice(0,10);
    const clock = kind === "sheets" ? "09:00" : kind === "ahrefs" ? "09:30" : dailyAnalyticsCollectionTime;
    const candidate=new Date(`${day}T${clock}:00+08:00`);if(candidate>now)return candidate.toISOString();
  }
  throw new Error("Invalid collector schedule");
}

/** Configuration evidence is distinct from a successful execution receipt. */
function automationHours(value?: string) {
  if (!value || !/^\d{1,2}(,\d{1,2})*$/.test(value)) return [];
  const hours = [...new Set(value.split(",").map(Number))].sort((a, b) => a - b);
  return hours.every(hour => hour >= 0 && hour <= 23) ? hours : [];
}

export function nextAutomationTime(rule: string, now: Date, status: string, workdaysOnly = false): string | null {
  if (status !== "ACTIVE") return null;
  const values = Object.fromEntries(rule.split(";").map(part => part.split("=")));
  const hours = automationHours(values.BYHOUR), minute = Number(values.BYMINUTE);
  if (!["DAILY", "WEEKLY", "MONTHLY"].includes(values.FREQ) || !hours.length || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  const weekdays = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const allowed = values.BYDAY?.split(",");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
  for (let offset = 0; offset < 63; offset++) {
    const day = new Date(Date.parse(today + "T00:00:00Z") + offset * 86400000);
    if (allowed && !allowed.includes(weekdays[day.getUTCDay()])) continue;
    if (values.FREQ === "MONTHLY") {
      if (values.BYSETPOS !== "1" || !allowed) return null;
      const earlierMatch = Array.from({ length: day.getUTCDate() - 1 }, (_, index) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), index + 1)))
        .some(candidate => allowed.includes(weekdays[candidate.getUTCDay()]));
      if (earlierMatch) continue;
    }
    for (const hour of hours) {
      const candidate = new Date(`${day.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`);
      if (candidate > now && (!workdaysOnly || isSeoWorkday(candidate))) return candidate.toISOString();
    }
  }
  return null;
}

const automationNotes: Record<string, string> = {
  "seo-16-25": "洛杉矶00:25目标窗口内，对照本机采集与生产归档核验真实日期、覆盖和缺口。北京时间09:25仅周一补采验收；其余候选按真实DST及原工作日门槛过滤，不代表每次唤醒均执行。",
  "seo-16-00-ga4-search-console": "洛杉矶00:00目标窗口内，沿原Google只读授权采集五站自然搜索、页面和搜索词，写回并核对生产归档。北京时间09:00仅周一分别补采周末已闭合日；双候选按真实DST及原工作日门槛过滤，未发布留待补。",
  "flatkey-5": "统一接续研究、制作、优化、审批发布和7／14／28天效果复查。有效且研究合格热点P0优先，其余延期按原ID及原会话在下个实际工作日补齐。业务周为北京时间周五至周四，跨两Monday桶只核一次额度；不抢租约、不替换正式任务。Flatkey暂停新落地页，博客和旧页优化继续。",
  "automation": "周四15:00开始定稿，16:00前完成下个周五至周四业务周的原任务排期及生产读回；跨两Monday桶只核一次额度。消费最新已完成复盘和有效热点P0证据，保留延期原ID、dueAt及在途任务；16:30新结论补原任务或后续候选。",
  "seo-09-00-github-traffic": "北京时间工作日10:10，通过本机GitHub CLI采集两个提示词仓库的浏览和克隆，保留GitHub UTC日桶并核对生产读回。",
  "seo-09-10-flatkey": "洛杉矶00:15目标窗口内，同步Flatkey首次自然搜索获客的sign_up_success去重用户并读回；全渠道UTC账户注册来源独立保留。北京时间09:15仅周一补采；其余候选按真实DST及原工作日门槛过滤，不将缺数填0。",
  "seo-10-00": "每日含周末发现近24小时新事件及近7天真实升温主题，核验官方事实与独立需求证据，扩当地关键词并完整去重。有效热点P0沿原任务补研究和最早合法空额，正式制作仍守实际工作日与原额度。Flatkey、RackRate、ModelFit原技术、GSC、404及PSI巡检继续。",
  "seo-14-00": "周三15:30准备下个周五至周四业务周的研究、意图去重与页面候选，供周四16:00前定稿。复用原任务与有效热点P0证据，核跨两Monday桶的实际工作日及一次额度；缺项明确保留。",
  "seo": "周二准备推广和内链；周四轮查其他旧文。历史待补证据持续保留。",
  "seo-2": "月初首个工作日复盘业务转化、市场投入和付费查询成本；形成任务，不另发月报群消息。",
  "seo-17-30": "洛杉矶01:30目标窗口内，用实际统计日生成、保存并读回独立日报预览；缺来源保存真实缺口。北京时间09:30仅周一分别补出周末日报；其余候选按真实DST及原工作日门槛过滤，不能合并周末数字。",
  "automation-2": "北京时间每日10:30，独立核验新Prompt的来源许可、成品、精确模型和去重，经原create-only内容接口导入并生产读回；不向GitHub或钉钉发送。",
  "seo-09-30-2": "周四16:30开始整理洛杉矶上周四至本周三的周报，保存版本供用户审核，注明真实覆盖及下周计划状态。",
  "seo-10-00-2": "原周五11:30自动发送已暂停；用户对具体周报版本明确批准后才沿原群和账本发送。",
  "seo-18-00": "洛杉矶02:00目标窗口内，沿原日报快照验收、群发送门槛和幂等账本处理；北京时间双候选按真实DST过滤。周四日报仅归档不群发、不在次日补发，周末补档不新增发送授权。",
  "seo-3": "独立检查并归档已结束且业务结果成功的SEO运行；当前暂停，保留配置和历史，不把归档当作业务交付完成。",
};
export function automationCadence(rule: string): string {
  const values = Object.fromEntries(rule.split(";").map(part => part.split("=")));
  const hours = automationHours(values.BYHOUR), minute = Number(values.BYMINUTE);
  if (!hours.length || !Number.isInteger(minute) || minute < 0 || minute > 59) return "时段待核实";
  const times = hours.map(hour => `${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}`);
  const time = hours.length > 1 && hours.at(-1)! - hours[0] === hours.length - 1
    ? `${times[0]}–${times.at(-1)} 每小时` : times.join("、");
  if (["DAILY", "WEEKLY"].includes(values.FREQ) && values.BYDAY === "MO,TU,WE,TH,FR") return `工作日 ${time}`;
  if (values.FREQ === "DAILY") return `每日 ${time}`;
  const days: Record<string,string> = { MO:"一",TU:"二",WE:"三",TH:"四",FR:"五",SA:"六",SU:"日" };
  if (values.FREQ === "MONTHLY" && values.BYSETPOS === "1" && values.BYDAY === "MO,TU,WE,TH,FR") return `月初首个工作日 ${time}`;
  if (values.FREQ === "WEEKLY" && values.BYDAY?.split(",").every((day: string) => days[day])) return `周${values.BYDAY.split(",").map((day: string) => days[day]).join("、")} ${time}`;
  return "时段待核实";
}
export const automationConfigurationVerifiedAt = automationConfig.verifiedAt;
const automationWindowGates = new Set(["seo-16-00-ga4-search-console", "seo-09-10-flatkey", "seo-16-25", "seo-17-30", "seo-18-00"]);
const automationDependencies: Record<string, string[]> = {
  "seo-16-00-ga4-search-console": ["洛杉矶窗口及周一补采门控", "Google 只读授权", "来源真实闭合日与生产读回"],
  "seo-09-10-flatkey": ["同批采集与洛杉矶窗口", "首次自然搜索注册口径", "生产逐日读回"],
  "seo-16-25": ["同批采集与注册回执", "来源日期和覆盖证据", "生产归档逐项核验"],
  "flatkey-5": ["原任务研究及正式计划资格", "业务周跨桶额度与有效租约", "准确版本审批和生产回执"],
  "automation": ["截止时最新已完成的复盘和研究证据", "产能与关键词缺口确认", "周四16:00前正式计划生产读回"],
  "seo-17-30": ["当天采集回执", "跨周任务与审批台账"],
  "automation-2": ["真实素材与许可证据", "精确模型与成品去重", "create-only导入与生产读回"],
  "seo-09-30-2": ["洛杉矶周四至周三的来源回执", "真实数据覆盖与缺口", "下周候选或正式计划状态"],
  "seo-10-00-2": ["用户明确批准的具体周报版本", "平台发送门控已验收", "周报独立防重锁"],
  "seo-18-00": ["日报最终快照", "平台发送门控已验收", "防重复发送锁"],
};

export function configurationOnlyOperationsStatus(now = new Date(), note = "执行记录暂不可读取；以下仅为已回读的自动化配置"): OperationsStatus {
  return { checkedAt: now.toISOString(), automationConfigurationVerifiedAt, executionEvidence: "unavailable", evidenceNote: note,
    controls: { enabled: false, emergencyStopped: false, maxRunCostMicros: 0, maxMonthCostMicros: 0, discoveryMaxCostMicros: 0 },
    scheduler: { configured: false, cadence: schedulerCadence, state: "UNCONFIRMED", lastStartedAt: null, lastCompletedAt: null },
    plans: configuredAutomationPlans(now), records: [] };
}

export function configuredAutomationPlans(now: Date): OperationsStatus["plans"] {
  const ordered = [...automationConfig.tasks].sort((a, b) => {
    const minute = (rule: string) => { const fields = Object.fromEntries(rule.split(";").map(part => part.split("="))); return automationHours(fields.BYHOUR)[0] * 60 + Number(fields.BYMINUTE); };
    return minute(a.rrule) - minute(b.rrule) || a.id.localeCompare(b.id);
  });
  return ordered.map(task => ({ id: task.id, name: task.name, location: "Codex · 本机在线执行",
    cadence: automationWindowGates.has(task.id) ? `候选唤醒：${automationCadence(task.rrule)}`
      : task.workdaysOnly ? automationCadence(task.rrule).replace(/^每日 /, "工作日 ") : automationCadence(task.rrule), state: task.status === "ACTIVE" ? "配置已启用 · 成功待回执" : "配置已暂停",
    nextAt: nextAutomationTime(task.rrule, now, task.status, task.workdaysOnly),
    dependencies: automationDependencies[task.id] ?? [],
    note: `${automationNotes[task.id] ?? "以执行回执核对结果。"} 配置核对于 ${automationConfig.verifiedAt}，实时启停以 Codex 为准。`,
  }));
}

export const operationStateLabels: Record<string, string> = {
  PLANNED: "已排队", RUNNING: "执行中", PENDING: "等待响应", QUEUED: "等待结果", RECEIVED: "结果已保存", ACTIVE: "执行中",
  COMPLETED: "已完成", COMPLETE: "已完成", FINISHED: "已完成", PARTIAL: "部分完成", FAILED: "失败", UNKNOWN: "响应不明，已停止提交", NEEDS_REVIEW: "异常，已停止提交", IMPORT_FAILED: "结果已保存，导入异常",
  DISABLED: "自动付费关闭", NOT_DUE: "未到执行时间", NOT_SCHEDULED: "尚未启用计划", PAUSED: "已暂停", UNAVAILABLE: "暂不可用",
  WAITING_FOR_DISCOVERY: "等待新词发现完成", TIME_BUDGET_EXHAUSTED: "后台续跑中", PERIOD_ALREADY_CAPTURED: "本期已采集",
};
