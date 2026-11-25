import type { OperationsStatus } from "./operations";
import { seoTablePage, type SeoTablePagination } from "./seo-table-page";

export type ReadonlyAutomationPlan = OperationsStatus["plans"][number] & {
  executionLocation: "computer" | "server" | "unknown";
  configurationState: "enabled" | "paused" | "unknown";
  nextConfiguredAt: string | null;
};

type ScheduleConfiguration = Pick<OperationsStatus, "plans" | "executionEvidence"> & {
  controls: Pick<OperationsStatus["controls"], "enabled" | "emergencyStopped">;
  scheduler: Pick<OperationsStatus["scheduler"], "configured" | "cadence">;
};

/** Configuration evidence never becomes proof that a task ran successfully. */
export function readonlyAutomationPlans(status: Pick<ScheduleConfiguration, "plans" | "controls">): ReadonlyAutomationPlan[] {
  return status.plans.map(plan => {
    const executionLocation = plan.location.startsWith("Codex") ? "computer"
      : ["rankings", "traffic"].includes(plan.id) ? "server" : "unknown";
    const configurationState = plan.id === "rankings"
      ? status.controls.emergencyStopped || !status.controls.enabled ? "paused" : "enabled"
      : plan.state.startsWith("配置已暂停") ? "paused"
      : plan.state.startsWith("配置已启用") ? "enabled" : "unknown";
    return { ...plan, executionLocation, configurationState,
      nextConfiguredAt: configurationState === "paused" || !plan.nextAt || !Number.isFinite(Date.parse(plan.nextAt)) ? null : plan.nextAt };
  });
}

export type AutomationScheduleRow = Pick<ReadonlyAutomationPlan, "id" | "name" | "cadence" | "configurationState" | "executionLocation">;
export type AutomationSchedulePage = SeoTablePagination & {
  rows: AutomationScheduleRow[];
  executionEvidence: OperationsStatus["executionEvidence"];
};

const locationOrder = { computer: 0, server: 1, unknown: 2 };

export function automationSchedulePage(status: ScheduleConfiguration, page: number): AutomationSchedulePage {
  const rows: AutomationScheduleRow[] = readonlyAutomationPlans(status)
    .filter(plan => plan.id !== "seo-10-00-2")
    .map(({ id, name, cadence, configurationState, executionLocation }) => ({ id, name, cadence, configurationState, executionLocation }));
  rows.push({
    id: "server-schedule-coordinator", name: "服务器调度检查与续跑", cadence: status.scheduler.cadence,
    executionLocation: "server",
    configurationState: status.executionEvidence === "unavailable" ? "unknown" : status.scheduler.configured ? "enabled" : "paused",
  });
  rows.sort((a, b) => locationOrder[a.executionLocation] - locationOrder[b.executionLocation]);
  return { ...seoTablePage(rows, page), executionEvidence: status.executionEvidence };
}

export function automationDate(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "未核实";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}

export const automationSchedulerLabels: Record<OperationsStatus["scheduler"]["state"], string> = {
  UNCONFIRMED: "尚无已完成检查的证据",
  HEALTHY: "最近一次调度检查已完成",
  OVERDUE: "调度检查已超时，需排查",
  ERROR: "最近一次调度检查异常",
};
