import { AsyncLocalStorage } from "node:async_hooks";

const reads = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

// One HTTP read can derive several views from one canonical input. Nothing is
// retained across requests, and mutations never enter this scope.
export function withRequestReads<T>(read: () => Promise<T>): Promise<T> {
  return reads.run(new Map(), read);
}

export function requestRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const scope = reads.getStore();
  if (!scope) return read();
  const existing = scope.get(key);
  if (existing) return existing as Promise<T>;
  const pending = Promise.resolve().then(read);
  scope.set(key, pending);
  return pending;
}
