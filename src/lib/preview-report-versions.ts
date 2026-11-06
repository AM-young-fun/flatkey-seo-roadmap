import "server-only";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isLocalPreviewOrigin, isLocalPreviewRequest } from "./preview-origin";
import { reportInputSchema, reportPayload, validateReportRanges, type ReportEvidence } from "./seo-report";
import type { DateRange } from "./seo-date-range";

export async function previewReportVersions(request: Request): Promise<Response | null> {
  if (process.env.NODE_ENV !== "development" || !process.env.SEO_PREVIEW_UPSTREAM_TOKEN || !isLocalPreviewRequest(request)) return null;
  const url = new URL(request.url);
  const headers = { "Cache-Control": "private, no-store" };
  const root = process.cwd() + "/.local/report-versions";
  await mkdir(root, { recursive: true });
  if (request.method === "GET") {
    const id = url.searchParams.get("id");
    if (id && !z.uuid().safeParse(id).success) return NextResponse.json({ message: "编号无效" }, { status: 400, headers });
    const files = id ? [id + ".json"] : (await readdir(root)).filter(f => /^[a-f0-9-]+\.json$/.test(f));
    try {
      const versions = await Promise.all(files.map(async f => JSON.parse(await readFile(root + "/" + f, "utf8"))));
      return NextResponse.json(id ? versions[0] : versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(({ id, kind, periodStart, periodEnd, createdAt }) => ({ id, kind, periodStart, periodEnd, createdAt })), { headers });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return NextResponse.json({ message: "报告不存在" }, { status: 404, headers });
      throw error;
    }
  }
  if (request.method !== "POST" || !isLocalPreviewOrigin(request)) return NextResponse.json({ message: "仅允许本地同源保存" }, { status: 403, headers });
  const parsed = reportInputSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ message: "报告参数无效" }, { status: 400, headers });
  const input = parsed.data;
  try { validateReportRanges(input); }
  catch { return NextResponse.json({ message: "区间须为1至366个已结束日" }, { status: 400, headers }); }
  const file = root + "/" + input.id + ".json";
  const compatible = (old: { periodStart: string; periodEnd: string; payload: { comparisonRange?: DateRange | null } }) =>
    old.periodStart === input.start && old.periodEnd === input.end
    && JSON.stringify(old.payload.comparisonRange ?? null) === JSON.stringify(input.comparison ?? null);
  try {
    const old = JSON.parse(await readFile(file, "utf8"));
    return compatible(old) ? NextResponse.json(old, { headers }) : NextResponse.json({ message: "请求编号冲突" }, { status: 409, headers });
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }

  const read = async (path: string, range: DateRange) => {
    const response = await fetch("https://flatkey-seo-roadmap.vercel.app" + path + "?site=flatkey.ai&" + new URLSearchParams(range), {
      headers: { Authorization: `Bearer ${process.env.SEO_PREVIEW_UPSTREAM_TOKEN}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Error("线上证据读取失败");
    return response.json();
  };
  const load = async (range: DateRange): Promise<ReportEvidence> => {
    const [daily, groups] = await Promise.all([read("/api/traffic/daily", range), read("/api/traffic/daily/groups", range)]);
    return { daily, groups };
  };
  const [current, comparison] = await Promise.all([load({ start: input.start, end: input.end }), input.comparison ? load(input.comparison) : null]);
  const record = { id: input.id, kind: "INTERVAL", periodStart: input.start, periodEnd: input.end, createdAt: new Date().toISOString(), storage: "local-preview", payload: reportPayload(input, current, comparison) };
  try { await writeFile(file, JSON.stringify(record), { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const old = JSON.parse(await readFile(file, "utf8"));
    return compatible(old) ? NextResponse.json(old, { headers }) : NextResponse.json({ message: "请求编号冲突" }, { status: 409, headers });
  }
  return NextResponse.json(record, { status: 201, headers });
}
