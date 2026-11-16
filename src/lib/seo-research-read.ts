import { timingSafeEqual } from "node:crypto";

const researchRoutes = new Set(["/api/keywords", "/api/topics"]);
const tokenPattern = /^seo_research_[a-f0-9]{64}$/;
const headerName = "x-seo-research-key";

export function authorizeResearchRead(request: Request): boolean | null {
  const provided = request.headers.get(headerName);
  if (
    request.method !== "GET" ||
    !researchRoutes.has(new URL(request.url).pathname) ||
    provided === null
  ) {
    return null;
  }

  const expected = process.env.SEO_RESEARCH_READ_KEY;
  if (!expected || !tokenPattern.test(expected) || !tokenPattern.test(provided)) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}
