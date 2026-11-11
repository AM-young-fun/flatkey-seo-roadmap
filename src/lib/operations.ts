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
  "10-30-seo": "读取三张表，只同步新增和变更；保留人工审核。来源失败时记录影响范围，禁止用旧数据冒充本次完成。",
  "flatkey-5": "每日源文英文2篇、日文/巴西葡文/西班牙西语各1篇，先研究对应国家关键词。GPU为主、API为辅；先生成测试版及审批材料，未经逐页版本批准不能发布。",
  "automation": "周四定稿下周一至周日的本国关键词、落地页、源文和旧页/集群事项；周五10点周报引用定稿版本。缺证据不凑数。",
  "seo-09-30": "补充候选和证据，不重选已定稿任务；搜索量 ≥10、KD＜30 优先，例外记录业务理由。",
  "seo-10-00": "五站基础检查；新页、改动页和异常页深审。Google 索引证据与线上 HTTP 检查分开。",
  "seo-13-30": "每天准备 5 个旧页审核稿；需负责人确认的改稿不能自动写入 CMS。草稿不算已优化页面。",
  "seo-14-30": "读取已定关键词制作落地页，先试点 1 页，再按每周 5 页目标推进；事实、功能、语言及转化逐项验收。",
  "seo-15-00": "执行四站各自有独立价值的工具或内容任务；记录站内功能完成与进入 Flatkey 的路径。",
  "seo-16-00": "只恢复未完成项；已有发布回执先核对，不重复发布。保存验证结果和下一步。",
  "seo-14-00": "为下周准备搜索意图、关键词、本地化和现有页面冲突证据；缺项明确保留。",
  "seo": "周二准备推广和内链；周四轮查其他旧文。历史待补证据持续保留。",
  "seo-2": "月初首个工作日复盘业务转化、市场投入和付费查询成本；形成任务，不另发月报群消息。",
  "seo-17-30": "补同步下午回执，用实际来源日期生成报告预览；来源失败也保留缺失说明。",
  "automation-2": "每天准备图片与视频Prompt素材和版本审批。公开库提交、生产导入须对应版本批准和明确发布授权；保留来源及许可证据。",
  "seo-09-30-2": "周五09:30生成上周五至本周四的周报预览，核对下周已定事项和数据截止日，不发群消息。",
  "seo-10-00-2": "周五10:00发送周报；与当天18:00日报分别防重。需平台门控、发送凭据和最终快照验收通过。",
  "seo-18-00": "每天18:00发日报，周五也发；日报包含跨周待审任务及缺材料项，结尾链接“数据基础”。发送前验证凭据、报告类型、发送锁和版本。",
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
  "10-30-seo": ["三表可读", "平台导入凭据可用"],
  "seo-09-30": ["三表同步回执", "国家与语言对应"],
  "flatkey-5": ["已审核周计划", "本国关键词证据", "可访问测试版及截图", "逐页版本批准后才允许发布"],
  "seo-13-30": ["旧页基线", "可核实内容证据", "逐页版本审批"],
  "seo-14-30": ["已定落地页关键词", "功能验收", "逐页版本审批"],
  "seo-15-00": ["站点源码", "来源归因检查", "逐页版本审批"],
  "seo-16-00": ["发布回执与批准版本一致", "正式页可访问"],
  "automation": ["周四研究完成", "产能与关键词缺口确认"],
  "seo-17-30": ["当天采集回执", "跨周任务与审批台账"],
  "automation-2": ["真实素材与许可证据", "去重检查", "逐页版本审批后才允许生产导入"],
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
