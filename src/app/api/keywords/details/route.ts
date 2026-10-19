import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { displayViewSpec } from "@/lib/services/display-views";
import { rebuildDisplaySnapshot } from "@/lib/services/display-snapshots";
import { normalizeKeywordText } from "@/lib/keyword-relevance";
import { REGION_CODES } from "@/lib/seo";
import type { DashboardKeyword } from "@/lib/types";
import type { KeywordOkrItem } from "@/lib/keyword-okr";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request) {
  const started = performance.now(), p = new URL(request.url).searchParams;
  const country = p.get("country") ?? "all", site = p.get("site") ?? "all", pool = p.get("pool") ?? "FORMAL", view = p.get("rank") ?? "FORMAL", mapping = p.get("pageStatus") ?? "ALL";
  const page = Number(p.get("page") ?? "1"), q = normalizeKeywordText(p.get("q") ?? "");
  if (!["all",...REGION_CODES].includes(country) || !["all","flatkey.ai","rackrate.org","modelfit.cc"].includes(site) || !["FORMAL","RESEARCH"].includes(pool)
    || !["FORMAL","EVIDENCE","TOP_10","TOP_30","TOP_50","TOP_100","UNRANKED"].includes(view) || !["ALL","MONITORABLE","PAGE_BUILD","PAGE_EXPAND"].includes(mapping)
    || !Number.isSafeInteger(page) || page < 1 || page > 100000 || q.length > 300) return NextResponse.json({message:"筛选参数无效"},{status:400});
  const spec = displayViewSpec(new URLSearchParams({view:"dashboard",includeResearch:pool === "RESEARCH" ? "1" : "0"}));
  type StoredMember = DashboardKeyword & {_okr?:KeywordOkrItem;_pageKey?:string;_search?:string};
  type PageRow = {total:number; groups:Array<{id:string;text:string;members:StoredMember[]}>;builtAt:Date;stale:boolean};
  const read = () => prisma.$queryRaw<PageRow[]>`
    WITH saved AS (SELECT "keywordRows", "builtAt", revision > "builtRevision" AS stale FROM "DisplaySnapshot" WHERE key = ${spec.key} AND "keywordRows" IS NOT NULL),
    scoped AS (SELECT g->>'id' AS id, g->>'text' AS text, m.members
      FROM saved CROSS JOIN LATERAL jsonb_array_elements("keywordRows") g
      CROSS JOIN LATERAL (SELECT jsonb_agg(member) AS members FROM jsonb_array_elements(g->'members') member WHERE ${site} = 'all' OR COALESCE(member->>'siteDomain','flatkey.ai') = ${site}) m
      WHERE m.members IS NOT NULL),
    prepared AS (SELECT scoped.*, (SELECT MIN((r.value->>'rank')::numeric) FROM jsonb_array_elements(members) member CROSS JOIN LATERAL jsonb_each(member->'latestRanks') r
      WHERE (${country} = 'all' OR r.key = ${country}) AND r.value->>'source' = 'dataforseo_serp' AND r.value->>'rankStatus' = 'ranked' AND (r.value->>'rank')::numeric BETWEEN 1 AND 100) AS position FROM scoped),
    matched AS (SELECT * FROM prepared WHERE
      (${q} = '' OR EXISTS(SELECT 1 FROM jsonb_array_elements(members) member WHERE strpos(member->>'_search',${q}) > 0))
      AND (${mapping} = 'ALL' OR EXISTS(SELECT 1 FROM jsonb_array_elements(members) member WHERE member->>'_pageKey' = CASE ${mapping} WHEN 'MONITORABLE' THEN 'MATCHED' WHEN 'PAGE_BUILD' THEN 'BUILD' ELSE 'EXPAND' END))
      AND (${view} = 'FORMAL' OR (${view} = 'EVIDENCE' AND position IS NOT NULL) OR (${view} = 'UNRANKED' AND position IS NULL)
        OR (${view} = 'TOP_10' AND position <= 10) OR (${view} = 'TOP_30' AND position BETWEEN 11 AND 30) OR (${view} = 'TOP_50' AND position BETWEEN 31 AND 50) OR (${view} = 'TOP_100' AND position BETWEEN 51 AND 100))),
    paged AS (SELECT id,text,members,position FROM matched ORDER BY (position IS NOT NULL) DESC, lower(text) COLLATE "C", id LIMIT 10 OFFSET ${(page-1)*10})
    SELECT (SELECT count(*)::integer FROM matched) AS total, COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'text',text,'members',members) ORDER BY (position IS NOT NULL) DESC,lower(text) COLLATE "C",id) FROM paged),'[]'::jsonb) AS groups,
      "builtAt", stale FROM saved`;
  try {
    let result = (await read())[0];
    if (!result) {await rebuildDisplaySnapshot(spec);result = (await read())[0];}
    if (!result) return NextResponse.json({message:"词库汇总正在准备，请稍后重试"},{status:503,headers:{"Retry-After":"5"}});
    if(result.stale) after(async () => {try{await rebuildDisplaySnapshot(spec);}catch{console.error("Keyword display refresh failed");}});
    const members = result.groups.flatMap(group => group.members), okr = members.flatMap(member => member._okr ? [member._okr] : []);
    const keywords = members.map(member => {const {_okr,_pageKey,_search,...row}=member;void _okr;void _pageKey;void _search;return row;});
    const payload = {keywords,okr:{initialized:true,keywords:okr,tasks:[]},total:result.total,page,pageSize:10,usingDemoData:false,topics:[],regions:REGION_CODES,latestRun:null,targetDomain:null,
      displaySnapshot:{generatedAt:result.builtAt.toISOString(),pending:result.stale},order:"ranked-first-alphabetical"};
    const timing = performance.now()-started;
    return NextResponse.json(p.get("profile") === "1" ? {durationMs:timing,payloadBytes:Buffer.byteLength(JSON.stringify(payload)),returnedKeywords:result.groups.length,total:result.total,storage:"persisted-paginated"} : payload,
      {headers:{"Cache-Control":"private, no-store","Server-Timing":`keyword-page;dur=${timing.toFixed(1)}`}});
  } catch {return NextResponse.json({message:"关键词暂时无法读取，请稍后重试"},{status:503,headers:{"Cache-Control":"private, no-store"}});}
}
