export const DETAIL_URL: "https://flatkey-seo-roadmap.vercel.app";
export function actionCardPayload(report: { title: string; text: string }): { msgtype: "actionCard"; actionCard: { title: string; text: string; btnOrientation: "0"; singleTitle: "查看详情"; singleURL: typeof DETAIL_URL } };
export function messageHash(payload: ReturnType<typeof actionCardPayload>): string;
