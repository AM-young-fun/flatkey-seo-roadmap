import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeKeywordText } from "@/lib/keyword-relevance";

// Read saved source membership once per library request. Do not infer GPU
// membership from model names, URL paths, ranking hits or page readiness.
export async function loadCloudGpuKeywordTexts(): Promise<Set<string>> {
  const words = await prisma.$queryRaw<Array<{ text: string }>>(Prisma.sql`
    /* keyword-business:cloud-source */
    SELECT DISTINCT word->>'keyword' AS text
    FROM "KeywordSourceRow" source CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(source.snapshot->'keywords') = 'array' THEN source.snapshot->'keywords' ELSE '[]'::jsonb END
    ) word
    WHERE source."siteDomain" = 'flatkey.ai' AND source."sourceId" = 'cloud_main'
      AND jsonb_typeof(word->'keyword') = 'string'
  `);
  return new Set(words.map(word => normalizeKeywordText(word.text)));
}
