import { nextSerpPeriodDue, nextSerpPeriodKey, periodDue, serpPeriod, scheduledSerpDue } from "./serp-periods";
import automationConfig from "./data/seo-automation-config.json";

export type OperationsStatus = {
  checkedAt: string;
  automationConfigurationVerifiedAt: string;
  executionEvidence?: "available" | "unavailable";
  evidenceNote?: string;
  controls: { enabled: boolean; emergencyStopped: boolean; maxRunCostMicros: number; maxMonthCostMicros: number; discoveryMaxCostMicros: number };
  scheduler: { configured: boolean; cadence: "每5分钟检查及续跑任务"; state: "UNCONFIRMED" | "HEALTHY" | "OVERDUE" | "ERROR"; lastStartedAt: string | null; lastCompletedAt: string | null };
  plans: { id: string; name: string; location: string; cadence: string; state: string; nextAt: string | null; note: string; dependencies?: string[]; currentExecution?: string }[];
  records: { id: string; name: string; state: string; startedAt: string; completedAt: string | null; detail: string; failedDiscoveryId?: string }[];
};

export function schedulerState(last: { startedAt: Date; completedAt: Date | null; status: string } | null, now: Date): OperationsStatus["scheduler"]["state"] {
  if (!last) return "UNCONFIRMED";
  if (last.status === "FAILED" || last.status === "NEEDS_REVIEW") return "ERROR";
  if (now.getTime() - last.startedAt.getTime() > 75 * 60_000) return "OVERDUE";
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
    const clock = kind === "sheets" ? "09:00" : kind === "ahrefs" ? "09:30" : "08:30";
    const candidate=new Date(`${day}T${clock}:00+08:00`);if(candidate>now)return candidate.toISOString();
  }
  throw new Error("Invalid collector schedule");
}

/** Configuration evidence is distinct from a successful execution receipt. */
export function nextAutomationTime(rule: string, now: Date, status: string): string | null {
  if (status !== "ACTIVE") return null;
  const values = Object.fromEntries(rule.split(";").map(part => part.split("=")));
  const hour = Number(values.BYHOUR), minute = Number(values.BYMINUTE);
  if (!["DAILY", "WEEKLY", "MONTHLY"].includes(values.FREQ) || !Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
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
    const candidate = new Date(`${day.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`);
    if (candidate > now) return candidate.toISOString();
  }
  return null;
}

const automationNotes: Record<string, string> = {
  "flatkey-5": "按已确认的周计划制作源博客，Flatkey 四国每国每周最多 5 个关键词，GPU 为主、API 为辅。真实博客和译文按质量门槛自动发布。",
  "automation": "周四定稿下周一至周日的本国关键词、落地页、源文和旧页/集群事项；周五10点周报引用定稿版本。缺证据不凑数。",
  "seo-09-30": "研究结果保存到平台的关键词和 TopicMap；搜索量 ≥10、KD＜30 优先。目标已有承接页时进入页面优化，无承接页时进入关键词页面搭建。",
  "seo-10-00": "五站技术质检；新增、改动和异常页优先。把可修复问题送工作任务，日报引用真实检查回执。",
  "seo-13-30": "扫描搜索意图并登记异常。每日最多优化 2 篇博客，保存基线与版本；非博客页面改动送审。",
  "seo-14-30": "每周最多 3 个落地页关键词。独立分支制作，部署测试环境后将证据提交工作任务审批。",
  "seo-15-00": "使用各集群站已经支持的内容语言，只有进入 Flatkey 的引导带来源 UTM。",
  "seo-16-00": "核对审批、独立分支及最新 SHA；通过站点已有发布入口交付批准版本。正式验收后持续采集页面效果。",
  "seo-14-00": "为下周准备搜索意图、关键词、本地化和现有页面冲突证据；缺项明确保留。",
  "seo": "周二准备推广和内链；周四轮查其他旧文。历史待补证据持续保留。",
  "seo-2": "月初首个工作日复盘业务转化、市场投入和付费查询成本；形成任务，不另发月报群消息。",
  "seo-17-30": "补同步下午回执，用实际来源日期生成报告预览；来源失败也保留缺失说明。",
  "automation-2": "核对来源许可、素材、模型和去重后自动导入合格 Prompt；记录真实上线与 GitHub 渠道证据。",
  "seo-09-30-2": "周五09:30生成上周五至本周四的周报预览，核对下周已定事项和数据截止日，不发群消息。",
  "seo-10-00-2": "周五10:00发送周报；与当天18:00日报分别防重。需平台门控、发送凭据和最终快照验收通过。",
  "seo-18-00": "每天18:00发日报，周五也发；简版含优化效果、技术质检与待审批数，结尾链接该日平台详情。",
};
export function automationCadence(rule: string): string {
  const values = Object.fromEntries(rule.split(";").map(part => part.split("=")));
  const hour = Number(values.BYHOUR), minute = Number(values.BYMINUTE);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return "时段待核实";
  const time = `${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}`;
  if (values.FREQ === "DAILY") return `每日 ${time}`;
  const days: Record<string,string> = { MO:"一",TU:"二",WE:"三",TH:"四",FR:"五",SA:"六",SU:"日" };
  if (values.FREQ === "MONTHLY" && values.BYSETPOS === "1" && values.BYDAY === "MO,TU,WE,TH,FR") return `月初首个工作日 ${time}`;
  if (values.FREQ === "WEEKLY" && values.BYDAY === "MO,TU,WE,TH,FR") return `工作日 ${time}`;
  if (values.FREQ === "WEEKLY" && values.BYDAY?.split(",").every((day: string) => days[day])) return `周${values.BYDAY.split(",").map((day: string) => days[day]).join("、")} ${time}`;
  return "时段待核实";
}
export const automationConfigurationVerifiedAt = automationConfig.verifiedAt;
const automationDependencies: Record<string, string[]> = {
  "seo-09-30": ["平台关键词与 TopicMap", "国家与语言对应"],
  "flatkey-5": ["已审核周计划", "当地关键词证据", "CMS 发布回执"],
  "seo-13-30": ["旧页基线", "可核实内容证据", "非博客逐页版本审批"],
  "seo-14-30": ["已定落地页关键词", "功能验收", "逐页版本审批"],
  "seo-15-00": ["站点源码", "来源归因检查", "逐页版本审批"],
  "seo-16-00": ["独立分支及当前提交", "平台逐页批准", "正式页回执与效果"],
  "automation": ["周四研究完成", "产能与关键词缺口确认"],
  "seo-17-30": ["当天采集回执", "跨周任务与审批台账"],
  "automation-2": ["真实素材与许可证据", "去重检查", "生产导入与读回证据"],
  "seo-09-30-2": ["截至周四的数据回执", "周四已审核下周计划"],
  "seo-10-00-2": ["周报最终快照", "平台发送门控已验收", "周报独立防重锁"],
  "seo-18-00": ["日报最终快照", "平台发送门控已验收", "防重复发送锁"],
};

export function configurationOnlyOperationsStatus(now = new Date(), note = "执行记录暂不可读取；以下仅为已回读的自动化配置"): OperationsStatus {
  return { checkedAt: now.toISOString(), automationConfigurationVerifiedAt, executionEvidence: "unavailable", evidenceNote: note,
    controls: { enabled: false, emergencyStopped: false, maxRunCostMicros: 0, maxMonthCostMicros: 0, discoveryMaxCostMicros: 0 },
    scheduler: { configured: false, cadence: "每5分钟检查及续跑任务", state: "UNCONFIRMED", lastStartedAt: null, lastCompletedAt: null },
    plans: configuredAutomationPlans(now), records: [] };
}

export function configuredAutomationPlans(now: Date): OperationsStatus["plans"] {
  const ordered = [...automationConfig.tasks].sort((a, b) => {
    const minute = (rule: string) => { const fields = Object.fromEntries(rule.split(";").map(part => part.split("="))); return Number(fields.BYHOUR) * 60 + Number(fields.BYMINUTE); };
    return minute(a.rrule) - minute(b.rrule) || a.id.localeCompare(b.id);
  });
  return ordered.map(task => ({ id: task.id, name: task.name, location: "Codex · 本机在线执行",
    cadence: automationCadence(task.rrule), state: task.status === "ACTIVE" ? "配置已启用 · 成功待回执" : "配置已暂停",
    nextAt: nextAutomationTime(task.rrule, now, task.status),
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
