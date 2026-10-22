import { keywordRelevance, normalizeKeywordText } from "./keyword-relevance";

export const CANDIDATE_REVIEW_LABELS = { UNRELATED: "业务无关", COMPETITOR: "竞品品牌", LOW_QUALITY: "低质量", KEEP: "保留候选" } as const;
export type CandidateReviewKind = keyof typeof CANDIDATE_REVIEW_LABELS;
export type CandidateReviewRow = { id: string; text: string; kind: CandidateReviewKind; reason: string; protected: boolean; businessCategory?: import("./keyword-business").KeywordBusiness };
export type CandidateReviewPreview = { siteDomain: "flatkey.ai"; stateHash: string; total: number; suggested: number; rows: CandidateReviewRow[] };

// Service competitors only. Model families, hardware vendors and integration
// clients (Claude Code, Cline, Cursor, etc.) are deliberately not brand exclusions.
const competitors = /(?:^|[^a-z0-9])(?:openrouter|open\s+router|portkey|litellm|apipark|apify|kie[.\s-]?ai|runpod|vast[.\s]ai|lambda\s+labs|lambdalabs|tensordock|saladcloud|salad\s+(?:gpu|cloud)|runcomfy|siliconflow|groq(?:cloud)?|cerebras|hetzner|akash\s+network|massed\s+compute|thunder\s+compute|compshare(?:\.cn)?|routeway|routway|routellm|routerhub|primeroute|getunikey|unikey|1key|2cw|cloudflare|vercel|kong(?:[.\s]ai|\s+konnect)?|nginx|haproxy|traefik|amazon\s+bedrock|aws\s+bedrock|hugging\s*face\s+inference|labarna|higgsfield|vibepeak)(?:$|[^a-z0-9])/iu;
const unrelatedExact = new Set([
  "ai account reconciliation", "ai expense management", "ai for finance operations", "ai for finance teams", "ai invoice reconciliation",
  "ai automation for contractors", "clinical evidence ai", "evidence ai medicine", "ai website migration", "direct deposit api",
  "direct vs indirect supplier", "esignature api pricing", "fl studio api", "money management api", "nasdaq api pricing",
  "reliable api for up-to-date account balances", "unifi access api", "unified health api", "vehicle routing api", "zendesk api pricing",
  "jira api base url", "6sense api pricing", "level access ai", "zip ai procurement", "what is byok encryption",
  "missingkeymissing key-pair-id query parameter or cookie value", "portal de desenvolvedor interno vs plataforma", "内部開発者ポータル vs プラットフォーム",
  "ai customer feedback", "how to use ai for customer feedback", "customer service ai use cases", "api adoption funnel", "api funnel", "funnel api",
  "what are the api error-handling and rate-limiting differences between kontent.ai and contentstack?", "企業情報api 料金 費用",
  "billing platform for finance teams not engineering", "how do i implement approval flows for workflows before they go to production?",
  "what are restb.ai comparable properties' pricing tiers and api quotas?",
]);
const lowQualityExact = new Set([
  "a new model", "a4b", "ai alternative", "ai implementation checklist", "ai kpi dashboard", "approval ai", "analytics token comparison",
  "budget alerts", "cookie alternatives", "cost visibility", "deepseek vs", "vs deepseek", "dispatch checklist via api", "fallback plan",
  "gateway alternatives", "gateway architecture", "gateway pricing", "gemini api k", "new benchmark tests models", "new evaluation",
  "one base", "open route", "openai best", "per customer", "platform fees", "quickstart api", "quota limit", "router comparison tool",
  "router vs gateway", "seed 2026", "self hosted proxy server", "stage api shared image-growning and language contr", "gpt per",
  "deepseek 呢", "e o deepseek?", "how bout gemini", "how does this compare to claude", "geminiと比較して", "トラフィック制御 コスト",
  "トラフィック制御 価格", "トラフィック制御 費用", "key not found", "plan key", "flat api", "flat ia", "key ia", "grokbpt",
  "model names", "pay per call service", "pay per call service provider", "how does pay per call work", "oem ai audio models",
  "cookie not found", "image buddy", "imagebuddy", "routemotion", "ranbell image", "tpm library sdk",
]);

export function reviewCandidateKeyword(text: string, protectedModel = false): Pick<CandidateReviewRow, "kind" | "reason"> {
  if (protectedModel) return { kind: "KEEP", reason: "模型保护词，保留" };
  const word = normalizeKeywordText(text);
  const relevance = keywordRelevance("flatkey.ai", word);
  if (relevance.status === "unrelated") return { kind: "UNRELATED", reason: relevance.reason ?? "已审核业务无关" };
  if (/vercel ai sdk.*(?:custom provider|base url|stop\(\)|custom transport)/u.test(word)) return { kind: "KEEP", reason: "客户端 SDK 接入与兼容需求，保留" };
  const competitor = word.match(competitors);
  if (competitor) return { kind: "COMPETITOR", reason: `包含竞品服务商品牌：${competitor[0].trim()}；按本轮候选词政策移除` };
  if (unrelatedExact.has(word) || /\b(?:hurom|ibanez|g[ -]?shock|gst b[23]00|tp[ -]?link|bg3|cs2|gta v|halo infinite|jedi survivor|sons of the forest|fallout 4|far cry 6|hell let loose|the finals|msfs|new world)\b/iu.test(word)) {
    return { kind: "UNRELATED", reason: "搜索对象为非本站业务的产品、游戏或通用业务系统" };
  }
  if (!word || lowQualityExact.has(word)) return { kind: "LOW_QUALITY", reason: "词义不完整、缺少业务对象或无法独立判断搜索意图" };
  // Keep useful technical flags and natural-language questions. Reject search
  // operator residue, imported metadata and document/code fragments explicitly.
  if (/^[%+]/u.test(word) || /(?:^|\s)(?:site[:.]|filetype:|inurl:|intitle:|ext:)/u.test(word)
    || /^https?:\/\//u.test(word) || /\s-site:/u.test(word)) return { kind: "LOW_QUALITY", reason: "搜索指令、网址或采集查询残留，不是独立目标词" };
  if (/^(?:docs\.x\.ai|xai (?:api|grok).*(?:aspect_ratio|b64_json))|(?:bridge_.*\.py|(?:api_key|auth_token).*(?:settings|secrets|credentials|config)\.(?:json|py|ts|yaml)|routing\.p95|bofu,primary|image-growning)/u.test(word)) {
    return { kind: "LOW_QUALITY", reason: "代码/配置片段或导入标签混入关键词" };
  }
  if (word.length > 500 || /^\(2\) off-peak rates/u.test(word) || /^(?:gemini 3 flash preview is only available|share claude code and earn|an ai image generator with an api enables)/u.test(word)) {
    return { kind: "LOW_QUALITY", reason: "整段用户画像、宣传语或说明文本，不是独立搜索需求" };
  }
  return { kind: "KEEP", reason: "保留业务候选；不因未知/零搜索量、语言或模型名称自动移除" };
}
