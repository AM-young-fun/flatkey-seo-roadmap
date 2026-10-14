import { createHmac } from "node:crypto";

// Domain separation keeps this token distinct from both page login and cron
// credentials. An explicit environment variable can override/rotate it later.
export function getRankingImportSecret(): string | null {
  if (process.env.RANKING_IMPORT_SECRET)
    return process.env.RANKING_IMPORT_SECRET;
  const rootSecret = process.env.CRON_SECRET || process.env.LOGIN_PWD;
  if (!rootSecret) return null;
  return createHmac("sha256", rootSecret)
    .update("flatkey-seo-roadmap:ranking-import:v1")
    .digest("hex");
}
