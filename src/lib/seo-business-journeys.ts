import { z } from "zod";

export const journeyLabels = { gpu: ["GPU 页面访问", "开始租赁", "成功租赁"], api: ["注册", "首次成功使用", "首次付款"] } as const;
export const journeySchema = z.object({
  business: z.enum(["gpu", "api"]), status: z.enum(["ready", "partial", "unavailable"]),
  reason: z.string().max(500).optional(), closedFunnel: z.literal(true), identity: z.literal("ga4-reporting-identity"),
  steps: z.array(z.object({ name: z.string().max(100), users: z.number().int().nonnegative(),
    abandonments: z.number().int().nonnegative().nullable(), completionRate: z.number().min(0).max(1).nullable(),
  }).strict()).max(3),
}).strict().superRefine((row, ctx) => {
  if (row.status === "ready" && row.steps.length !== 3) ctx.addIssue({ code: "custom", message: "漏斗缺少步骤" });
  if (row.status === "unavailable" && row.steps.length) ctx.addIssue({ code: "custom", message: "不可用漏斗不应有数值" });
  if (row.steps.some((step, i) => step.name !== journeyLabels[row.business][i] || i > 0 && step.users > row.steps[i - 1].users)) ctx.addIssue({ code: "custom", message: "封闭漏斗步骤无效" });
});
export const engagementSchema = z.object({
  status: z.enum(["ready", "partial", "unavailable"]), reason: z.string().max(500).optional(),
  engagementSeconds: z.number().nonnegative().nullable(), activeUsers: z.number().int().nonnegative().nullable(),
  activeTimeCustomMetric: z.enum(["registered", "missing", "unverified"]),
}).strict();
export type BusinessJourney = z.infer<typeof journeySchema>;
export type BusinessEngagement = z.infer<typeof engagementSchema>;
