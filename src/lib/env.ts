export function envString(name: string, fallback = ""): string {
  const value = process.env[name];
  return value === undefined || value === null ? fallback : value;
}

export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function envBool(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

// Provider credentials alone must never start paid rank checks. Enabling them
// is a separate operational decision after the target pool has been approved.
export function isSerpMonitoringEnabled(): boolean {
  return process.env.SERP_MONITORING_ENABLED === "true" && !envBool("DISABLE_EXTERNAL_FETCH");
}
