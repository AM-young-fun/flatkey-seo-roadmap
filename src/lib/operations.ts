import { isSeoWorkday } from "./seo-workday";
import { nextSerpPeriodDue, nextSerpPeriodKey, periodDue, serpPeriod, scheduledSerpDue } from "./serp-periods";
import automationConfig from "./data/seo-automation-config.json";
import deploymentConfig from "../../vercel.json";

export const dailyAnalyticsCollectionTime = "16:00";
import { seoScheduleOpensAt } from "./seo-schedule-window";

export const schedulerCadence = "每日 10:10–23:55，每 5 分钟检查及续跑";

/** An authentication secret also supports authorized manual callers. It does
 * not prove that the deployed project has any hosted cron configured. */
export function deployedSeoSchedulerConfigured(secret: string | undefined, crons: readonly { path: string; schedule: string }[] = deploymentConfig.crons): boolean {
  return Boolean(secret?.trim()) && crons.some(cron => /^\/api\/cron\/daily-rankings(?:\?[^#]*)?$/u.test(cron.path) && cron.schedule.trim().length > 0);
}

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
  "seo-16-00-ga4-search-console": "每天 16:00 独立采集 GA4／GSC、Flatkey 流量和注册，同轮完成三站巡检、404、效果复查及热点。周末数据周一按各来源日补采，延期只核上一日真实缺口。",
  "flatkey-5": "工作日 10:15、14:15 分批制作和优化。独立页面可并行，按原任务逐项领取、回填、读回并结租。",
  "automation": "周四 14:20 独立核季度原词和原市场搜索意图，覆盖新增、维护、技术及旧任务续做，保存总排期和交付日供同日周报读取。",
  "seo": "每天 09:30 轮查 5–10 篇已上线的 Flatkey 或 ModelFit 旧文。合格项按现有优化和翻新额度登记，候选不足时保留缺口。",
  "automation-2": "每天 10:30 核验新 Prompt 的来源许可、成品、模型和去重，经原仅新建接口导入并读回。",
  "seo-09-30-2": "周四 16:30 启动等待。当日轮查、Prompt、制作、排期及采集巡检均有结果后，归档洛杉矶上周四至本周三的周报。",
  "seo-18-00": "每天 18:00 启动等待。当日适用的前序工作均有结果后归档日报。周末稿周一按各来源日分别归档。发送由用户在日报页触发。",
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
const automationDependencies: Record<string, string[]> = {
  "seo-16-00-ga4-search-console": ["Google 只读授权与真实来源日", "采集与巡检生产回执"],
  "flatkey-5": ["原任务研究及正式计划资格", "业务周跨桶额度与有效租约", "准确版本审批和生产回执"],
  "automation": ["冻结季度原词及原市场 Top 10／3C", "正式计划生产读回"],
  "seo": ["真实已上线原页", "原词原市场排名和 GSC 证据", "在途任务去重"],
  "automation-2": ["真实素材与许可证据", "精确模型与成品去重", "create-only导入与生产读回"],
  "seo-09-30-2": ["本轮适用的前序终态回执", "洛杉矶周四至周三来源回执", "下周正式计划或明确缺口"],
  "seo-18-00": ["本轮适用的前序终态回执", "日报确切版本生产读回"],
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
    cadence: task.workdaysOnly ? automationCadence(task.rrule).replace(/^每日 /, "工作日 ") : automationCadence(task.rrule),
    state: task.status === "ACTIVE" ? "配置已启用 · 成功待回执" : "配置已暂停",
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
