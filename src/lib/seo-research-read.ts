export const SEO_RESEARCH_KEY_HEADER = "x-seo-research-key";
export const SEO_RESEARCH_KEY_PREFIX = "seo_research_";
export const SEO_RESEARCH_READ_PATHS = ["/api/keywords", "/api/topics"] as const;

export function hasResearchReadHeader(request: Request) {
  return request.method === "GET" &&
    SEO_RESEARCH_READ_PATHS.some(path => path === new URL(request.url).pathname) &&
    request.headers.has(SEO_RESEARCH_KEY_HEADER);
}
