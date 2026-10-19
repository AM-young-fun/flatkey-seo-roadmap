import { randomUUID } from "node:crypto";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { prisma } from "@/lib/prisma";
const compress = promisify(gzip), decompress = promisify(gunzip);
export type DisplayBuild = { value: object; keywordRows?: unknown[] };
export type DisplaySpec = { key: string; build: () => Promise<DisplayBuild> };
type Row = { body: Uint8Array | null; revision: number; builtRevision: number; builtAt: Date | null; leaseUntil: Date | null };
export type DisplayRead = { body: string; generatedAt: string; stale: boolean };

// Durable leases make this work across cold workers and deployments. Source
// invalidation during a build stays dirty: only the claimed revision is published.
export async function rebuildDisplaySnapshot(spec: DisplaySpec): Promise<boolean> {
  const token = randomUUID();
  const claimed = await prisma.$queryRaw<Array<{revision:number}>>`
    INSERT INTO "DisplaySnapshot" (key, "leaseToken", "leaseUntil") VALUES (${spec.key}, ${token}, NOW() + INTERVAL '4 minutes')
    ON CONFLICT (key) DO UPDATE SET "leaseToken" = EXCLUDED."leaseToken", "leaseUntil" = EXCLUDED."leaseUntil"
    WHERE ("DisplaySnapshot"."leaseUntil" IS NULL OR "DisplaySnapshot"."leaseUntil" < NOW())
      AND ("DisplaySnapshot".body IS NULL OR "DisplaySnapshot"."revision" > "DisplaySnapshot"."builtRevision")
    RETURNING revision`;
  if (!claimed.length) return false;
  try {
    const { value, keywordRows } = await spec.build();
    const generatedAt = new Date().toISOString();
    const body = await compress(JSON.stringify({ ...value, displaySnapshot: { generatedAt, revision: claimed[0].revision } }));
    await prisma.$executeRaw`UPDATE "DisplaySnapshot" SET body = ${body}, "keywordRows" = ${keywordRows ? JSON.stringify(keywordRows) : null}::jsonb,
      "builtRevision" = ${claimed[0].revision}, "builtAt" = ${new Date(generatedAt)}, "leaseToken" = NULL, "leaseUntil" = NULL, "lastError" = NULL
      WHERE key = ${spec.key} AND "leaseToken" = ${token}`;
    return true;
  } catch (error) {
    await prisma.$executeRaw`UPDATE "DisplaySnapshot" SET "leaseToken" = NULL, "leaseUntil" = NULL, "lastError" = 'BUILD_FAILED'
      WHERE key = ${spec.key} AND "leaseToken" = ${token}`.catch(() => {});
    throw error;
  }
}

export async function readDisplaySnapshot(spec: DisplaySpec): Promise<DisplayRead> {
  const read = () => prisma.$queryRaw<Row[]>`SELECT body, revision, "builtRevision", "builtAt", "leaseUntil" FROM "DisplaySnapshot" WHERE key = ${spec.key}`;
  let row = (await read())[0];
  // Bootstrap only. All subsequent page reads use the persisted result; dirty
  // snapshots are refreshed after the response or by the existing coordinator.
  if (!row?.body) {
    await rebuildDisplaySnapshot(spec);
    row = (await read())[0];
  }
  if (!row?.body || !row.builtAt) throw Object.assign(new Error("Display snapshot is preparing"), { code: "DISPLAY_PREPARING" });
  return { body: (await decompress(row.body)).toString(), generatedAt: row.builtAt.toISOString(), stale: row.revision > row.builtRevision };
}

export async function invalidateDisplaySnapshots() {
  await prisma.$executeRaw`UPDATE "DisplaySnapshot" SET revision = revision + 1 WHERE key LIKE 'display-v1:%'`;
}
