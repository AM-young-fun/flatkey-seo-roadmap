import { AsyncLocalStorage } from "node:async_hooks";

type ReadTiming = { phase: string; durationMs: number };
const profiles = new AsyncLocalStorage<ReadTiming[]>();

export async function timedRead<T>(phase: string, read: () => Promise<T>): Promise<T> {
  const timings = profiles.getStore();
  if (!timings) return read();
  const started = performance.now();
  try { return await read(); }
  finally { timings.push({ phase, durationMs: Math.round((performance.now() - started) * 10) / 10 }); }
}

// Opt-in, authenticated diagnostics contain only durations and aggregate sizes.
// No query text, provider requests, credentials or business rows are exposed.
export async function profileRead<T>(read: () => Promise<T>) {
  const phases: ReadTiming[] = [], started = performance.now();
  const value = await profiles.run(phases, read);
  let databaseRegion: string | null = null;
  try { databaseRegion = new URL(process.env.DATABASE_URL ?? "").hostname.match(/\b((?:af|ap|ca|eu|il|me|mx|sa|us)-(?:[a-z]+-){1,2}\d)\./)?.[1] ?? null; } catch { /* Never expose a connection string. */ }
  return { value, durationMs: Math.round((performance.now() - started) * 10) / 10, phases, applicationRegion: process.env.VERCEL_REGION ?? "local", databaseRegion };
}
