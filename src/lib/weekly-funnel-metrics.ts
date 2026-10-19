import type { WeeklyTrafficEvidence } from "./weekly-traffic-evidence";
import { registrationRate, relativeChange } from "./weekly-traffic";

export function weeklyFunnelMetrics(funnel: WeeklyTrafficEvidence["newVisitorFunnel"]) {
  if (!funnel || funnel.current.length < 2 || funnel.current.length !== funnel.previous.length ||
    funnel.current.some((step, index) => step.name !== funnel.previous[index]?.name)) return null;
  const pack = (steps: NonNullable<typeof funnel>["current"]) => {
    if (steps.some((step, index) => !Number.isInteger(step.users) || step.users < 0 || index > 0 && step.users > steps[index - 1].users)) return null;
    const visitors = steps[0].users, registrations = steps.at(-1)!.users;
    return { visitors, registrations, rate: registrationRate(visitors, registrations) };
  };
  const current = pack(funnel.current), previous = pack(funnel.previous);
  if (!current || !previous) return null;
  return { current, previous, change: relativeChange(current.rate, previous.rate),
    ratePoints: current.rate != null && previous.rate != null ? (current.rate - previous.rate) * 100 : null };
}
