import type { DashboardResponse } from "./types";

export function compactDashboard(value: DashboardResponse): DashboardResponse {
  return { ...value, keywords: value.keywords.map(keyword => {
    const { volumeReview, ...row } = keyword;
    return { ...row, volumeReviewLabel: volumeReview?.label ?? row.volumeReviewLabel };
  }) };
}
