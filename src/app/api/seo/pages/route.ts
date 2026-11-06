import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";
import { getRankingImportSecret } from "@/lib/import-credential";
import { importSecretMatches } from "@/lib/ranking-import";
import { isLocalPreviewOrigin, isLocalPreviewRequest } from "@/lib/preview-origin";
import { prisma } from "@/lib/prisma";
import { parseSitemap, mergeInventory, type InventoryPage } from "@/lib/seo-page-inventory";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
const rootUrl = "https://flatkey.ai/sitemap.xml";
const previewFile = () => process.cwd() + "/.local/page-inventory.json";
const preview = (request: Request) => process.env.NODE_ENV === "development" && Boolean(process.env.SEO_PREVIEW_UPSTREAM_TOKEN) && isLocalPreviewRequest(request);
async function authorized(request: Request) {
  if (preview(request)) return true;
  const secret = getRankingImportSecret();
  if (secret && importSecretMatches(request.headers.get("authorization"), secret)) return true;
  return isAuthEnabled() && await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value);
}
async function load(local: boolean): Promise<InventoryPage[]> {
  if (local) {
    try { return JSON.parse(await readFile(previewFile(), "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }
  return (await prisma.seoPageInventory.findMany({ orderBy: [{ firstSeen: "desc" }, { url: "asc" }] }))
    .map(row => ({ ...row, firstSeen: row.firstSeen.toISOString(), lastSeen: row.lastSeen.toISOString() }));
}
function response(pages: InventoryPage[], local: boolean) {
  return NextResponse.json({ source: rootUrl, ruleVersion: 1, storage: local ? "local-preview" : "database", capturedAt: pages.map(p => p.lastSeen).sort().at(-1) ?? null, pages }, { headers });
}
export async function GET(request: Request) {
  if (!await authorized(request)) return NextResponse.json({ message: "请先登录" }, { status: 401, headers });
  try { return response(await load(preview(request)), preview(request)); }
  catch { return NextResponse.json({ message: "页面台账读取失败，请检查存储连接" }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  if (!await authorized(request)) return NextResponse.json({ message: "请先登录或使用已有采集凭据" }, { status: 401, headers });
  const local = preview(request);
  const origin = request.headers.get("origin");
  if (local ? !isLocalPreviewOrigin(request) : origin && origin !== new URL(request.url).origin) return NextResponse.json({ message: "请求来源无效" }, { status: 403, headers });
  try {
    const existing = await load(local);
    const read = async (url: string) => {
      const fetched = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000) });
      if (!fetched.ok) throw Error("生产 sitemap 读取失败");
      const xml = await fetched.text();
      if (xml.length > 10_000_000) throw Error("sitemap过大");
      return parseSitemap(xml, url);
    };
    const index = await read(rootUrl);
    const parts = await Promise.all(index.children.map(read));
    if (parts.some(part => part.children.length)) throw Error("不支持多层sitemap索引");
    const pages = [...new Map([...index.pages, ...parts.flatMap(part => part.pages)].map(page => [page.url, page])).values()];
    if (pages.length > 50000) throw Error("站点页面超出本次同步上限");
    const collectedAt = new Date().toISOString();
    if (local) {
      const updated = mergeInventory(existing, pages, collectedAt);
      await mkdir(process.cwd() + "/.local", { recursive: true });
      const temporary = previewFile() + "." + crypto.randomUUID();
      await writeFile(temporary, JSON.stringify(updated), { mode: 0o600 });
      await rename(temporary, previewFile());
      return response(updated, true);
    }
    await prisma.$transaction(async tx => {
      // Serialize concurrent collectors so the first baseline cannot overwrite a later discovery.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(160412)`;
      const prior = (await tx.seoPageInventory.findMany()).map(row => ({ ...row, firstSeen: row.firstSeen.toISOString(), lastSeen: row.lastSeen.toISOString() }));
      const merged = mergeInventory(prior, pages, collectedAt);
      const known = new Map(prior.map(row => [row.url, row]));
      await tx.seoPageInventory.createMany({ data: merged.filter(row => !known.has(row.url)).map(row => ({ ...row, firstSeen: new Date(row.firstSeen), lastSeen: new Date(row.lastSeen) })), skipDuplicates: true });
      await tx.seoPageInventory.updateMany({ where: { url: { in: pages.map(page => page.url) } }, data: { lastSeen: new Date(collectedAt) } });
      for (const page of pages) {
        const old = known.get(page.url);
        if (old && (old.category !== page.category || old.sitemapLastmod !== page.sitemapLastmod || old.sourceUrl !== page.sourceUrl)) {
          await tx.seoPageInventory.update({ where: { url: page.url }, data: { category: page.category, sitemapLastmod: page.sitemapLastmod, sourceUrl: page.sourceUrl } });
        }
      }
    }, { timeout: 30000 });
    return response(await load(false), false);
  } catch {
    return NextResponse.json({ message: "sitemap同步未完成，已保留原页面台账；请重试" }, { status: 503, headers });
  }
}
