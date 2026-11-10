import type { OperationsStatus } from "./operations";

export type ReadonlyAutomationPlan = OperationsStatus["plans"][number] & {
  executionLocation: "computer" | "server" | "unknown";
  configurationState: "enabled" | "paused" | "unknown";
  nextConfiguredAt: string | null;
};

/** Configuration evidence never becomes proof that a task ran successfully. */
export function readonlyAutomationPlans(status: OperationsStatus): ReadonlyAutomationPlan[] {
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
