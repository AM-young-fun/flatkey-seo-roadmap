import { z } from "zod";
import { collectionHash, GROWTH_COLLECTION_MARKETS, GrowthCollectionError } from "./growth-collection";
import { buildApprovedRankedKeywordsPage, quoteForLimit } from "./dataforseo-labs.cjs";
export const GROWTH_DISCOVERY_KIND="growth-discovery";
const identity=z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),version=z.number().int().nonnegative();
export const growthDiscoveryCommandSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("prepare"),id:identity,expectedVersion:version,site:z.enum(["flatkey.ai","rackrate.org","modelfit.cc"]),country:z.string().min(2).max(2),language:z.string().min(2).max(10),limit:z.number().int().min(1).max(1000),maxPages:z.number().int().min(1).max(20)}).strict(),
  z.object({action:z.literal("approve"),id:identity,expectedVersion:version,manifestHash:z.string().regex(/^[a-f0-9]{64}$/),maxCostMicros:z.number().int().nonnegative()}).strict(),
  z.object({action:z.literal("claim"),id:identity,expectedVersion:version,manifestHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  z.object({action:z.literal("receipt"),id:identity,expectedVersion:version,manifestHash:z.string().regex(/^[a-f0-9]{64}$/),page:z.number().int().nonnegative(),collectedAt:z.iso.datetime({offset:true}),raw:z.unknown(),rawText:z.string().max(16000000).optional()}).strict(),
]);
export type GrowthDiscoveryManifest={id:string;site:string;country:string;language:string;limit:number;maxPages:number;connectionVersion:number;preparedAt:string;expiresAt:string;pages:{index:number;offset:number;runId:string;maxCostMicros:number}[];maxCostMicros:number;hash:string};
export type GrowthDiscoveryState={id:string;version:number;manifest:GrowthDiscoveryManifest;approval:{actor:"human";hash:string;maxCostMicros:number;approvedAt:string}|null;pages:{index:number;runId:string;offset:number;status:"CLAIMED"|"SAVED"|"UNKNOWN";rawHash:string|null;returned:number|null;total:number|null;truncated:boolean|null;collectedAt:string|null;actualCostMicros:number|null}[];nextPage:number;complete:boolean;reason:string};
export function buildGrowthDiscoveryManifest(input:Extract<z.infer<typeof growthDiscoveryCommandSchema>,{action:"prepare"}>,connectionVersion:number,now=new Date()):GrowthDiscoveryManifest{
  const market=GROWTH_COLLECTION_MARKETS[input.country as keyof typeof GROWTH_COLLECTION_MARKETS];
  if(!market||market.language!==input.language)throw new GrowthCollectionError("discovery_market","原国家与语言不一致或未支持，禁止回落市场");
  const cap=quoteForLimit(input.limit).maxCostMicros,pages=Array.from({length:input.maxPages},(_,index)=>({index,offset:index*input.limit,runId:`gd-${input.id}-${index}`,maxCostMicros:cap}));
  const content={id:input.id,site:input.site,country:input.country,language:input.language,limit:input.limit,maxPages:input.maxPages,connectionVersion,preparedAt:now.toISOString(),expiresAt:new Date(now.getTime()+86400000).toISOString(),pages,maxCostMicros:pages.length*cap};
  return{...content,hash:collectionHash(content)};
}
export function assertGrowthDiscoveryManifest(manifest:GrowthDiscoveryManifest){const{hash,...content}=manifest;if(hash!==collectionHash(content)||manifest.pages.length!==manifest.maxPages||manifest.maxCostMicros!==manifest.maxPages*quoteForLimit(manifest.limit).maxCostMicros||manifest.pages.some((page,index)=>page.index!==index||page.offset!==index*manifest.limit||page.maxCostMicros!==quoteForLimit(manifest.limit).maxCostMicros||page.runId!==`gd-${manifest.id}-${index}`))throw new GrowthCollectionError("discovery_manifest_changed","分页清单、游标或费用已变化，须重审");}
export function approvedDiscoveryPageRequest(state:GrowthDiscoveryState,now=new Date()){
  assertGrowthDiscoveryManifest(state.manifest);
  if(!state.approval||state.approval.actor!=="human"||state.approval.hash!==state.manifest.hash||state.approval.maxCostMicros!==state.manifest.maxCostMicros||!state.pages.length&&Date.parse(state.manifest.expiresAt)<=now.getTime())throw new GrowthCollectionError("discovery_approval_required","分页须由用户批准确切页清单和总费用",403);
  if(state.complete)return null;
  if(state.pages.some(page=>page.status!=="SAVED"))throw new GrowthCollectionError("discovery_receipt_unknown","前页回执未确认，禁止重复请求或推进分页");
  if(state.reason==="SHORT_PAGE"||state.reason==="TOTAL_CHANGED")throw new GrowthCollectionError("discovery_cursor_review","前页为空/短页或供应商总量变化，先复核，不自动收费续页");
  const page=state.manifest.pages[state.nextPage];if(!page)return null;
  return{page,task:buildApprovedRankedKeywordsPage(state.manifest.limit,page.runId,{site:state.manifest.site,country:state.manifest.country,language:state.manifest.language,offset:page.offset})};
}
