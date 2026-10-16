import { z } from "zod";

export const SOURCE_SYNC_API_PATH = "/api/keywords/source-sync";
export const SOURCE_SYNC_SOURCES = {
  api_main: { nodeId: "P7QG4Yx2JpQn6qlZHqdNP3n989dEq3XD", sheetId: "kgqie6hm", url: "https://alidocs.dingtalk.com/i/nodes/P7QG4Yx2JpQn6qlZHqdNP3n989dEq3XD" },
  cloud_main: { nodeId: "EpGBa2Lm8a0NEam1UzaaEwBbJgN7R35y", sheetId: "kgqie6hm", url: "https://alidocs.dingtalk.com/i/nodes/EpGBa2Lm8a0NEam1UzaaEwBbJgN7R35y" },
  optimization: { nodeId: "YQBnd5ExVEYy670pc6vvKzDzVyeZqMmz", sheetId: "kgqie6hm", url: "https://alidocs.dingtalk.com/i/nodes/YQBnd5ExVEYy670pc6vvKzDzVyeZqMmz" },
} as const;
const text = z.string().trim().min(1).max(2000).refine(value => new TextEncoder().encode(value).length <= 2000, "关键词过长");
export const sourceSyncSchema = z.object({
  kind: z.literal("source-sync"), requestId: z.string().trim().min(1).max(160).regex(/^[\w.:-]+$/),
  targetDomain: z.literal("flatkey.ai"), action: z.enum(["preview", "apply"]),
  sourceId: z.enum(["api_main", "cloud_main", "optimization"]),
  collectedAt: z.iso.datetime({ offset: true }).optional(),
  expectedStateHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  rows: z.array(z.object({
    rowKey: z.string().trim().min(1).max(500).regex(/^[\p{L}\p{N}][\p{L}\p{N}._:/-]*$/u, "使用稳定slug/计划path/编号，不使用行号"),
    slug: z.string().trim().max(500).optional(), language: z.string().trim().max(40).optional(),
    title: z.string().trim().max(1000).optional(), topic: z.string().trim().max(500).optional(),
    completion: z.enum(["COMPLETED", "PENDING"]), rawStatus: z.string().trim().max(300).optional(),
    pageUrl: z.url().max(2000).optional(),
    publication: z.object({ pageVerified: z.boolean().default(false), verificationReason: z.string().trim().max(2000).optional() }).strict().default({ pageVerified: false }),
    keywords: z.array(z.object({ keyword: text, role: z.enum(["PRIMARY", "SECONDARY"]).default("SECONDARY"),
      relevance: z.enum(["RELEVANT", "REVIEW", "UNRELATED"]).default("REVIEW"),
      reason: z.string().trim().min(4).max(2000), pageIntentMatched: z.boolean().default(false), newModel: z.boolean().default(false),
    }).strict()).min(1).max(100),
  }).strict()).max(400),
}).strict().superRefine((value, context) => {
  if (new Set(value.rows.map(row => row.rowKey)).size !== value.rows.length) context.addIssue({ code: "custom", message: "同一批次rowKey不可重复" });
  if (value.rows.reduce((sum, row) => sum + row.keywords.length, 0) > 2000) context.addIssue({ code: "custom", message: "每批最多2000条行关键词" });
  if (value.collectedAt && Date.parse(value.collectedAt) > Date.now() + 300000) context.addIssue({ code: "custom", message: "来源读取时间不能在未来" });
});
export type SourceSyncPayload = z.infer<typeof sourceSyncSchema>;
export type SourceSyncSummary = { changedRows: number; unchangedRows: number; newKeywords: number; newMemberships: number;
  promotedFormal: number; heldResearch: number; blocked: number; conflicts: number; updatedMemberships: number };
export type SourceSyncResult = { kind: "source-sync"; requestId: string; targetDomain: "flatkey.ai"; sourceId: SourceSyncPayload["sourceId"];
  action: "preview" | "apply"; imported: number; duplicate: boolean; stateHash: string; sourceSummary: SourceSyncSummary;
  changes: Array<{ rowKey: string; keyword: string | null; action: string; fields: string[]; reason: string; verifyExisting?: true }>;
};
