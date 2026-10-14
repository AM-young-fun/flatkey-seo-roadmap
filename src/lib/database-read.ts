const TRANSIENT_ERRORS = new Set(["P1001", "P1002", "P1017", "P2024"]);

export function databaseErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "UNKNOWN";
  const code = "code" in error ? String(error.code ?? "") : "";
  if (code) return code;
  // Some engine/driver connection failures have no Prisma error code.
  const message = "message" in error ? String(error.message).toLowerCase() : "";
  if (/response from the engine was empty|query engine.*(closed|exit|empty)/.test(message)) return "ENGINE_EMPTY";
  if (/inconsistent query result/.test(message)) return "RELATION_INCONSISTENT";
  if (/prepared statement/.test(message)) return "PREPARED_STATEMENT_ERROR";
  if (/connection|timed?\s*out|timeout|broken pipe|socket|server closed/.test(message)) return "CONNECTION_INTERRUPTED";
  const name = "name" in error ? String(error.name) : "";
  if (["PrismaClientUnknownRequestError", "PrismaClientInitializationError", "PrismaClientRustPanicError", "TypeError", "RangeError"].includes(name)) return name;
  return "UNKNOWN";
}

export async function retryDatabaseRead<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    const code = databaseErrorCode(error);
    if (!TRANSIENT_ERRORS.has(code) && !["CONNECTION_INTERRUPTED", "ENGINE_EMPTY", "PrismaClientUnknownRequestError", "PrismaClientInitializationError"].includes(code)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 400));
    return read();
  }
}

// Wait for every scheduled read before retrying, so failed requests do not
// leave a second wave of queries competing with the retry for pool slots.
export async function settleReads<T extends unknown[]>(tasks: [...{ [K in keyof T]: Promise<T[K]> }]): Promise<T> {
  const results = await Promise.allSettled(tasks);
  const rejected = results.find((result) => result.status === "rejected");
  if (rejected?.status === "rejected") throw rejected.reason;
  return results.map((result) => (result as PromiseFulfilledResult<unknown>).value) as T;
}
