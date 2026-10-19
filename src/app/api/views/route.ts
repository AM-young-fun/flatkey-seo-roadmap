import { after, NextResponse } from "next/server";
import { displayViewSpec } from "@/lib/services/display-views";
import { readDisplaySnapshot, rebuildDisplaySnapshot } from "@/lib/services/display-snapshots";
import { databaseErrorCode } from "@/lib/database-read";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  let spec: ReturnType<typeof displayViewSpec>;
  try { spec = displayViewSpec(params); } catch { return NextResponse.json({message:"页面参数无效"},{status:400}); }
  const started = performance.now();
  try {
    const saved = await readDisplaySnapshot(spec);
    if(saved.stale) after(async () => {try {await rebuildDisplaySnapshot(spec);} catch {console.error("Display rebuild failed",spec.key);}});
    const headers = {"Content-Type":"application/json","Cache-Control":"private, no-store","X-Data-Generated-At":saved.generatedAt,"X-Data-Stale":String(saved.stale),"Server-Timing":`display;dur=${(performance.now()-started).toFixed(1)};desc="persisted"`};
    if(params.get("profile") === "1") return NextResponse.json({durationMs:performance.now()-started,payloadBytes:Buffer.byteLength(saved.body),generatedAt:saved.generatedAt,stale:saved.stale,storage:"persisted"},{headers});
    const body = saved.stale ? saved.body.replace('"displaySnapshot":{','"displaySnapshot":{"pending":true,') : saved.body;
    return new NextResponse(body,{headers});
  } catch(error) {return NextResponse.json({message:"汇总数据正在准备，请稍后重试",code:databaseErrorCode(error)},{status:503,headers:{"Cache-Control":"private, no-store","Retry-After":"5"}});}
}
