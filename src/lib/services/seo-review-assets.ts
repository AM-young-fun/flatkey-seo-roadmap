import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseReviewAsset, assetLabel, internalReviewAssetId, type ReviewAsset } from "../seo-review-assets";
import { workflowApprovalSchema, type WorkflowApproval, type WorkflowKind, type WorkflowRecord, workflowApprovalItemStatus } from "../seo-workflow";
import { prepareWorkflowMutation, workflowHash, WorkflowError, type WorkflowActor } from "../seo-workflow-state";
const KIND = "REVIEW_ASSET";
type Reader = Pick<Prisma.TransactionClient, "seoReportVersion">;
const publicAsset = ({ data: _data, actor: _actor, ...value }: ReviewAsset) => { void _data; void _actor; return value; };
function storedAsset(value: unknown): ReviewAsset {
  const asset = value as ReviewAsset;
  if (!asset || typeof asset.createdAt !== "string" || !["human","collector"].includes(asset.actor)) throw new WorkflowError("asset_corrupt", "截图回执不可验证", 503);
  const parsed = parseReviewAsset({approvalId:asset.approvalId,itemId:asset.itemId,contentVersion:asset.contentVersion,capturedVersion:asset.capturedVersion,viewport:asset.viewport,mime:asset.mime,data:asset.data});
  if(parsed.id!==asset.id || parsed.sha256!==asset.sha256 || parsed.bytes!==asset.bytes || parsed.url!==asset.url) throw new WorkflowError("asset_corrupt", "截图哈希不可验证", 503);
  return asset;
}
export async function validateInternalReviewAssets(approval: WorkflowApproval, db: Reader = prisma, requireReady = false) {
  for(const item of approval.items) for(const evidence of item.evidence) {
    let id: string|null;
    try { id=internalReviewAssetId(evidence.url); } catch { throw new WorkflowError("asset_binding_invalid", "截图地址无效"); }
    if(!id)continue;
    const row=await db.seoReportVersion.findUnique({where:{id:`review-asset:${id}`},select:{payload:true,kind:true}});
    if(!row || row.kind!==KIND)throw new WorkflowError("asset_binding_invalid", "截图不存在或尚未上传");
    const asset=storedAsset(row.payload);
    if ((requireReady || workflowApprovalItemStatus(approval,item.id)==="approved") && asset.capturedVersion!==item.contentVersion) throw new WorkflowError("asset_version_mismatch", "截图实际部署版本与待审版本不同");
    if(asset.approvalId!==approval.id || asset.itemId!==item.id || asset.contentVersion!==item.contentVersion || evidence.label!==assetLabel(asset.viewport,asset.capturedVersion)) throw new WorkflowError("asset_binding_invalid", "截图与审批单、页面、版本或端类型不一致");
  }
}
export async function getReviewAsset(id: string) {
  if(!/^[a-f0-9]{64}$/.test(id))throw new WorkflowError("asset_not_found", "截图不存在",404);
  const row=await prisma.seoReportVersion.findUnique({where:{id:`review-asset:${id}`},select:{payload:true,kind:true}});
  if(!row||row.kind!==KIND)throw new WorkflowError("asset_not_found", "截图不存在",404);
  return storedAsset(row.payload);
}
export async function uploadReviewAsset(input: unknown, actor: WorkflowActor) {
  let parsed: ReturnType<typeof parseReviewAsset>;
  try{parsed=parseReviewAsset(input);}catch{throw new WorkflowError("invalid_image", "仅接受不超过1MB的有效PNG或JPEG截图",400);}
  return prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('flatkey-seo-workflow-v1'))`;
    const rows=await tx.seoWorkflowRecord.findMany();
    const all=rows.map(row=>({kind:row.kind as WorkflowKind,record:row.payload as unknown as WorkflowRecord}));
    const prior=all.find(row=>row.kind==="approval"&&row.record.id===parsed.approvalId)?.record as WorkflowApproval|undefined;
    const item=prior?.items.find(row=>row.id===parsed.itemId);
    if(!prior||prior.status!=="draft"||!item||item.contentVersion!==parsed.contentVersion)throw new WorkflowError("asset_target_changed", "只可为现有草稿的当前页面版本上传；已提交审批内容不能改写");
    const existing=await tx.seoReportVersion.findUnique({where:{id:`review-asset:${parsed.id}`},select:{payload:true}});
    if(existing && item.evidence.some(row=>row.url===parsed.url))return {asset:publicAsset(storedAsset(existing.payload)),approvalVersion:prior.version};
    const now=new Date(),asset:ReviewAsset={...parsed,actor,createdAt:now.toISOString()};
    await tx.seoReportVersion.createMany({data:{id:`review-asset:${asset.id}`,kind:KIND,siteDomain:prior.siteDomain,periodStart:now,periodEnd:now,payload:asset as Prisma.InputJsonValue},skipDuplicates:true});
    const {version,updatedAt:_updatedAt,recordedAt:_recordedAt,submittedRecordedAt:_submittedRecordedAt,...raw}=prior;void _updatedAt;void _recordedAt;void _submittedRecordedAt;
    const record=workflowApprovalSchema.parse({...raw,items:prior.items.map(row=>row.id===item.id?{...row,evidence:[...row.evidence,{label:assetLabel(asset.viewport,asset.capturedVersion),url:asset.url,observedAt:asset.createdAt}]}:row)});
    const command={requestId:`asset-upload:${asset.id}`,action:"save_approval" as const,expectedVersion:version,record};
    const prepared=prepareWorkflowMutation(command,all,actor,now);
    await validateInternalReviewAssets(prepared.record as WorkflowApproval,tx);
    await tx.seoWorkflowRecord.update({where:{key:prepared.key},data:{version:prepared.record.version,payload:prepared.record as unknown as Prisma.InputJsonValue}});
    await tx.seoWorkflowEvent.create({data:{requestId:command.requestId,requestHash:workflowHash(command),recordKey:prepared.key,kind:"approval",version:prepared.record.version,payload:prepared.record as unknown as Prisma.InputJsonValue}});
    return {asset:publicAsset(asset),approvalVersion:prepared.record.version};
  },{maxWait:10000,timeout:30000});
}
