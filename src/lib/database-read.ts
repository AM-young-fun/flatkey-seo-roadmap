const TRANSIENT_ERRORS = new Set(["P1001", "P1002", "P1017", "P2024"]);

export async function retryDatabaseRead<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (!TRANSIENT_ERRORS.has(code)) throw error;
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
