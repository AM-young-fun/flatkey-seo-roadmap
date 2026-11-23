import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { emptyWeeklySupplement, nextWeeklySupplement, weeklySupplementInput, type WeeklySupplement } from "../seo-weekly-supplement";
import { WorkflowError } from "../seo-workflow-state";

const kind = "SEO_WEEKLY_SUPPLEMENT";
const previewDirectory = () => process.env.SEO_WEEKLY_SUPPLEMENT_PREVIEW_DIR ?? join(process.cwd(), ".local", "weekly-supplements");
async function reportDate(reportId: string, localPreview: boolean) {
  if (localPreview) return reportId.split(":")[1];
  const row = await prisma.seoReportVersion.findUnique({ where: { id: reportId } });
  const report = row?.payload as { kind?: string; date?: string } | undefined;
  if (!row || row.kind !== "SEO_DIGEST" || row.siteDomain !== "flatkey.ai" || report?.kind !== "weekly" || !report.date) throw new WorkflowError("report_not_found", "找不到这份周报", 404);
  return report.date;
}
export async function loadWeeklySupplement(reportId: string, localPreview = false): Promise<WeeklySupplement> {
  return loadWeeklySupplementForDate(await reportDate(reportId, localPreview), localPreview);
}
// Callers must already have loaded and validated the weekly report. Saves and
// standalone reads continue to resolve the exact report ID above.
export async function loadWeeklySupplementForDate(date: string, localPreview = false): Promise<WeeklySupplement> {
  const empty = emptyWeeklySupplement(date);
  if (localPreview) {
    const files = await readdir(previewDirectory()).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
    const latest = files.filter(file => file.startsWith(empty.id + ":") && file.endsWith(".json")).sort().at(-1);
    return latest ? JSON.parse(await readFile(join(previewDirectory(), latest), "utf8")) as WeeklySupplement : empty;
  }
  const row = await prisma.seoReportVersion.findFirst({ where: { kind, siteDomain: "flatkey.ai", periodStart: new Date(empty.periodStart), periodEnd: new Date(empty.periodEnd) }, orderBy: { id: "desc" }, select: { payload: true } });
  return row ? row.payload as unknown as WeeklySupplement : empty;
}
export async function saveWeeklySupplement(raw: unknown, localPreview = false) {
  const input = weeklySupplementInput.parse(raw), current = await loadWeeklySupplement(input.reportId, localPreview);
  let next: WeeklySupplement;
  try { next = nextWeeklySupplement(current, input); }
  catch { throw new WorkflowError("supplement_conflict", "补充说明已在其他窗口更新，请重新读取后再保存", 409); }
  const id = next.id + ":" + String(next.revision).padStart(6, "0");
  try {
    if (localPreview) {
      await mkdir(previewDirectory(), { recursive: true });
      await writeFile(join(previewDirectory(), id + ".json"), JSON.stringify(next), { flag: "wx" });
    } else {
      await prisma.seoReportVersion.create({ data: { id, kind, siteDomain: "flatkey.ai", periodStart: new Date(next.periodStart), periodEnd: new Date(next.periodEnd), payload: next as unknown as Prisma.InputJsonValue } });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST" || (error as { code?: string }).code === "P2002") throw new WorkflowError("supplement_conflict", "补充说明已在其他窗口更新，请重新读取后再保存", 409);
    throw error;
  }
  return next;
}
