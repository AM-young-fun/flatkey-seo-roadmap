import { ENDPOINT } from "@/lib/dataforseo-labs.cjs";

/** One non-retryable paid POST. Authorization and durable claim belong to the
 * caller; transport failure must remain UNKNOWN, never trigger another POST. */
export async function postDataForSeoLabsTask(task: Record<string, unknown>, credentials: {apiLogin:string;apiPassword:string}, timeoutMs=30000):Promise<string>{
  const response=await fetch(ENDPOINT,{method:"POST",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(Math.max(1,Math.min(timeoutMs,30000))),
    headers:{Authorization:`Basic ${Buffer.from(`${credentials.apiLogin}:${credentials.apiPassword}`).toString("base64")}`,"Content-Type":"application/json"},body:JSON.stringify([task])});
  return response.text();
}
