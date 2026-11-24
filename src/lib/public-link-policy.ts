type Href = string | { protocol?: string | null; hostname?: string | null; host?: string | null; pathname?: string | null } | undefined;
const origin = "https://flatkey-seo-roadmap.vercel.app";
const host = (value: string) => value.toLowerCase().replace(/^www\./, "");
/** Applied during server rendering as well as client navigation. */
export function externalLinkRel(href: Href, rel?: string): string | undefined {
  const protocol = href && typeof href !== "string" ? `${(href.protocol ?? "https").replace(/:$/, "")}:` : "https:";
  const value = typeof href === "string" ? href : href?.hostname || href?.host ? `${protocol}//${href.host ?? href.hostname}${href.pathname ?? "/"}` : href?.pathname;
  if (!value) return rel;
  try {
    const url = new URL(value, origin);
    if (!["http:", "https:", "ftp:"].includes(url.protocol) || host(url.hostname) === host(new URL(origin).hostname)) return rel;
    const tokens = [...new Set((rel ?? "").split(/\s+/).filter(Boolean).map(token => token.toLowerCase()))];
    if (!tokens.includes("nofollow")) tokens.push("nofollow");
    return tokens.join(" ");
  } catch { return rel; }
}
