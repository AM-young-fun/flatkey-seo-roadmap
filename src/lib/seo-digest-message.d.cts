export const DETAIL_URL: "https://flatkey-seo-roadmap.vercel.app/reports";
export type MessageReport = { title: string; text: string; kind?: "daily" | "weekly"; date?: string; id?: string };
export function reportDetailUrl(report: Partial<MessageReport>): string;
export function actionCardPayload(report: MessageReport): { msgtype: "actionCard"; actionCard: { title: string; text: string; btnOrientation: "0"; singleTitle: "查看详情"; singleURL: string } };
export function messageHash(payload: ReturnType<typeof actionCardPayload>): string;
export function digestSnapshotId(report: {
  date: string; text: string; detailText?: string; pagePerformance?: unknown; recentPages?: unknown;
  deliveryStates?: unknown; organicRegistrations?: unknown;
}): string;
