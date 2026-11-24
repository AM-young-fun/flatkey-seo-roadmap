import { z } from "zod";

// These are composite site/percent-encoded-word/market keys, not database IDs.
// An imported original can contain up to 2000 UTF-8 bytes before URI encoding.
export const GROWTH_LOGICAL_TARGET_ID_MAX_LENGTH = 7000;
export const growthLogicalTargetIdSchema = z.string().trim().min(1).max(GROWTH_LOGICAL_TARGET_ID_MAX_LENGTH);
