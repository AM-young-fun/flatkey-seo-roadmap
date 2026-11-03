import type { WeeklyTrafficChannelDimension, WeeklyTrafficEvidence } from "./weekly-traffic-evidence";

export type WeeklySeoTrafficEvidence = Omit<WeeklyTrafficEvidence, "directRegistrationCountries"> & {
  trafficScope: "organic_search";
  channelDimension: WeeklyTrafficChannelDimension;
};

const countIsValid = (value: number) => Number.isSafeInteger(value) && value >= 0;

// Existing audited exports use firstUserPrimaryChannelGroup. Keep that
// attribution when projecting history; session channels are a different cohort.
export function projectWeeklySeoTrafficEvidence(data: WeeklyTrafficEvidence | null | undefined): WeeklySeoTrafficEvidence | null {
  if (!data || !Array.isArray(data.channels)) return null;
  if (data.trafficScope && !["all_users", "organic_search"].includes(data.trafficScope)) return null;
  const channelDimension = data.channelDimension ?? "firstUserPrimaryChannelGroup";
  if (!["firstUserDefaultChannelGroup", "firstUserPrimaryChannelGroup"].includes(channelDimension)) return null;

  const organic = data.channels.filter(row => row.name === "Organic Search");
  // Missing detail is unknown, while an explicit Organic Search row can prove 0.
  if (organic.length !== 1 || new Set(data.channels.map(row => row.name)).size !== data.channels.length) return null;
  if (data.trafficScope === "organic_search" && data.channels.some(row => row.name !== "Organic Search")) return null;
  for (const period of ["current", "previous"] as const) {
    if (!countIsValid(data.totals[period].newUsers) || !countIsValid(data.totals[period].newRegistrations)) return null;
    if (data.channels.some(row => !countIsValid(row.newUsers[period]) || !countIsValid(row.registrations[period]))) return null;
    if (data.channels.reduce((sum, row) => sum + row.newUsers[period], 0) !== data.totals[period].newUsers ||
      data.channels.reduce((sum, row) => sum + row.registrations[period], 0) !== data.totals[period].newRegistrations) return null;
  }

  const channel = organic[0];
  return {
    complete: data.complete,
    trafficScope: "organic_search",
    channelDimension,
    totals: {
      current: { newUsers: channel.newUsers.current, newRegistrations: channel.registrations.current },
      previous: { newUsers: channel.newUsers.previous, newRegistrations: channel.registrations.previous },
    },
    channels: [{ name: channel.name, newUsers: { ...channel.newUsers }, registrations: { ...channel.registrations } }],
    sources: [...data.sources],
    ...(data.reportingCutoff ? { reportingCutoff: data.reportingCutoff } : {}),
    ...(data.trafficScope === "organic_search" && data.pageVisitors ? { pageVisitors: data.pageVisitors } : {}),
    ...(data.trafficScope === "organic_search" && data.pageTrends ? { pageTrends: data.pageTrends } : {}),
    ...(data.trafficScope === "organic_search" && data.codexSummary ? { codexSummary: data.codexSummary } : {}),
    ...(data.search ? { search: data.search } : {}),
    // Aggregate funnels cannot be filtered by subtracting paid channel totals.
    ...(data.trafficScope === "organic_search" && data.formFunnel ? { formFunnel: data.formFunnel } : {}),
    ...(data.trafficScope === "organic_search" && data.newVisitorFunnel ? { newVisitorFunnel: data.newVisitorFunnel } : {}),
  };
}
