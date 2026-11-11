import { z } from "zod";
export const webhookReceiptSchema = z.object({
  transport: z.literal("signed-webhook"), httpStatus: z.literal(200), errcode: z.literal(0),
  responseHash: z.string().regex(/^[a-f0-9]{64}$/), webhookConfigSha256: z.string().regex(/^[a-f0-9]{64}$/),
  acceptedAt: z.iso.datetime(), repository: z.literal("AM-young-fun/flatkey-seo-roadmap"), workflowRunId: z.string().regex(/^\d{1,20}$/),
  messageFormat: z.literal("actionCard").optional(), payloadSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  providerTraceId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/).optional(),
}).strict();
export type WebhookReceipt = z.infer<typeof webhookReceiptSchema>;
