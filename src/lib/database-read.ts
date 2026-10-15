const TRANSIENT_ERRORS = new Set(["P1001", "P1002", "P1017", "P2024"]);
const readPhases = new WeakMap<object, string>();

export function databaseReadPhase(error: unknown): string | null {
  return error && typeof error === "object" ? readPhases.get(error) ?? null : null;
}

export function databaseErrorCategory(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const meta = "meta" in error && error.meta && typeof error.meta === "object" ? error.meta : null;
  const sqlState = meta && "code" in meta ? String(meta.code) : "";
  if (/^[0-9A-Z]{5}$/.test(sqlState)) return `SQLSTATE_${sqlState}`;
  const message = "message" in error ? String(error.message).toLowerCase() : "";
  const messageState = message.match(/(?:sqlstate|code)[\s:="'`]*([0-9a-z]{5})\b/i)?.[1]?.toUpperCase();
  if (messageState && /^[0-9][0-9A-Z]{4}$/.test(messageState)) return `SQLSTATE_${messageState}`;
  // Describe result/driver failures without returning query text, credentials,
  // connection strings or arbitrary provider messages to the browser/logs.
  for (const [pattern, category] of [
    [/emaxconnsession|max client(?:s| connections)/, "CONNECTION_LIMIT"],
    [/deserializ/, "RESULT_DESERIALIZATION"], [/conver|cast/, "TYPE_CONVERSION"],
    [/serializ/, "RESULT_SERIALIZATION"], [/enum/, "ENUM_VALUE"],
    [/json/, "JSON_VALUE"], [/date|time value/, "DATE_VALUE"],
    [/syntax error/, "SQL_SYNTAX"], [/response from the engine was empty/, "ENGINE_EMPTY"],
    [/distinct.*order|order.*distinct/, "DISTINCT_ORDER"],
    [/column.*does not exist/, "COLUMN_MISSING"], [/operator does not exist/, "OPERATOR_TYPE"],
    [/parameter|bind/, "PARAMETER_BIND"], [/unsupported/, "UNSUPPORTED_RESULT"],
  ] as const) if (pattern.test(message)) return category;
  return null;
}

export function databaseErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "UNKNOWN";
  // Initialization errors expose errorCode; query errors expose code.
  // Return only Prisma's public code, never a connection URL or raw message.
  const candidate = ("code" in error ? error.code : undefined) ?? ("errorCode" in error ? error.errorCode : "");
  const code = /^P\d{4}$/.test(String(candidate ?? "")) ? String(candidate) : "";
  if (code) return code;
  // Some engine/driver connection failures have no Prisma error code.
  const message = "message" in error ? String(error.message).toLowerCase() : "";
  if (/emaxconnsession|max client(?:s| connections)/.test(message)) return "CONNECTION_LIMIT";
  if (/response from the engine was empty|query engine.*(closed|exit|empty)/.test(message)) return "ENGINE_EMPTY";
  if (/inconsistent query result/.test(message)) return "RELATION_INCONSISTENT";
  if (/prepared statement/.test(message)) return "PREPARED_STATEMENT_ERROR";
  if (/connection|timed?\s*out|timeout|broken pipe|socket|server closed/.test(message)) return "CONNECTION_INTERRUPTED";
  const name = "name" in error ? String(error.name) : "";
  if (["PrismaClientUnknownRequestError", "PrismaClientInitializationError", "PrismaClientRustPanicError", "TypeError", "RangeError"].includes(name)) return name;
  return "UNKNOWN";
}

export function isTransientDatabaseError(error: unknown) {
  const code = databaseErrorCode(error);
  return TRANSIENT_ERRORS.has(code) || ["CONNECTION_LIMIT", "CONNECTION_INTERRUPTED", "ENGINE_EMPTY", "PrismaClientUnknownRequestError", "PrismaClientInitializationError"].includes(code);
}

export async function retryDatabaseRead<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!isTransientDatabaseError(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 400));
    return read();
  }
}

// Wait for every scheduled read before retrying, so failed requests do not
// leave a second wave of queries competing with the retry for pool slots.
export async function settleReads<T extends unknown[]>(tasks: [...{ [K in keyof T]: Promise<T[K]> }], phases?: readonly string[]): Promise<T> {
  const results = await Promise.allSettled(tasks);
  const failedIndex = results.findIndex((result) => result.status === "rejected");
  const rejected = results[failedIndex];
  if (rejected?.status === "rejected") {
    if (phases?.[failedIndex] && rejected.reason && typeof rejected.reason === "object") readPhases.set(rejected.reason, phases[failedIndex]);
    throw rejected.reason;
  }
  return results.map((result) => (result as PromiseFulfilledResult<unknown>).value) as T;
}
