import { nextSerpPeriodDue, nextSerpPeriodKey, periodDue, serpPeriod, scheduledSerpDue } from "./serp-periods";
import * as automationConfig from "./data/seo-automation-config.json";

export type OperationsStatus = {
  checkedAt: string;
  automationConfigurationVerifiedAt: string;
  controls: { enabled: boolean; emergencyStopped: boolean; maxRunCostMicros: number; maxMonthCostMicros: number; discoveryMaxCostMicros: number };
  scheduler: { configured: boolean; cadence: "每5分钟检查及续跑任务"; state: "UNCONFIRMED" | "HEALTHY" | "OVERDUE" | "ERROR"; lastStartedAt: string | null; lastCompletedAt: string | null };
  plans: { id: string; name: string; location: string; cadence: string; state: string; nextAt: string | null; note: string; currentExecution?: string }[];
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
    const clock = kind === "sheets" ? "09:00" : kind === "ahrefs" ? "09:30" : "10:30";
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
  "flatkey-5": "每日源文 API 3 篇、GPU 2 篇；翻译另计。依赖已核实的周计划和关键词证据，发布后验收正式链接。",
  "automation": "周五定稿下周一至周日：5 个落地页、API 21 / GPU 14 个源文选题、旧页和集群事项。周末继续当前计划。",
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
  "seo-18-00": "最终切换后每天向 Flatkey seo/geo 发一条：周五周报，其他日日报；结尾链接“数据基础”。切换前保持暂停。",
};
const automationCadence: Record<string, string> = {
  "10-30-seo": "每日 09:00", "flatkey-5": "每日 10:30", automation: "周五 16:30",
  "seo-09-30": "每日 09:30", "seo-10-00": "每日 10:00", "seo-13-30": "每日 13:30",
  "seo-14-30": "工作日 14:30", "seo-15-00": "工作日 15:00", "seo-16-00": "每日 16:00",
  "seo-14-00": "周四 14:00", seo: "周二、周四 15:30", "seo-2": "月初首个工作日 15:00",
  "seo-17-30": "每日 17:30", "seo-18-00": "每日 18:00",
};
export const automationConfigurationVerifiedAt = automationConfig.verifiedAt;
export function configuredAutomationPlans(now: Date): OperationsStatus["plans"] {
  return automationConfig.tasks.map(task => ({ id: task.id, name: task.name, location: "Codex · 本机在线执行",
    cadence: automationCadence[task.id] ?? "查看 Codex 自动化", state: task.status === "ACTIVE" ? "配置已启用 · 成功待回执" : "配置已暂停",
    nextAt: nextAutomationTime(task.rrule, now, task.status),
    note: `${automationNotes[task.id] ?? "以执行回执核对结果。"} 配置核对于 ${automationConfig.verifiedAt}，实时启停以 Codex 为准。`,
  }));
}

export const operationStateLabels: Record<string, string> = {
  PLANNED: "已排队", RUNNING: "执行中", PENDING: "等待响应", QUEUED: "等待结果", RECEIVED: "结果已保存", ACTIVE: "执行中",
  COMPLETED: "已完成", COMPLETE: "已完成", FINISHED: "已完成", PARTIAL: "部分完成", FAILED: "失败", UNKNOWN: "响应不明，已停止提交", NEEDS_REVIEW: "异常，已停止提交", IMPORT_FAILED: "结果已保存，导入异常",
  DISABLED: "自动付费关闭", NOT_DUE: "未到执行时间", NOT_SCHEDULED: "尚未启用计划", PAUSED: "已暂停", UNAVAILABLE: "暂不可用",
  WAITING_FOR_DISCOVERY: "等待新词发现完成", TIME_BUDGET_EXHAUSTED: "后台续跑中", PERIOD_ALREADY_CAPTURED: "本期已采集",
};
