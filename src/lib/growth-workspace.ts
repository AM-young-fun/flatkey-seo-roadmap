import { isGrowthTopicPlaceholder } from "./seo-growth-markets";
import { growthContentProgress } from "./growth-content-progress";
import languageReview from "./data/ranking-word-language-review-20261123.json";
import { isOwnedBrandKeyword } from "./keyword-market-policy";
import { GROWTH_MARKET_LANGUAGES } from "./seo-growth-markets";
import type { GrowthHistoricalPeriod, GrowthLanguageStatus, GrowthMarket, GrowthMonitoringQuery, GrowthSite, GrowthTarget, GrowthTaskRelation, GrowthTopic, GrowthWorkspace } from "./growth-types";

export const GROWTH_SITES: GrowthSite[] = [
  { domain: "flatkey.ai", name: "Flatkey", execution: true, keywordGoals: true, trafficGoal: true, dataOnly: false },
  { domain: "rackrate.org", name: "RackRate", execution: true, keywordGoals: true, trafficGoal: false, dataOnly: false },
  { domain: "modelfit.cc", name: "ModelFit", execution: true, keywordGoals: true, trafficGoal: false, dataOnly: false },
  { domain: "rougecue.org", name: "RougeCue", execution: false, keywordGoals: false, trafficGoal: false, dataOnly: true },
  { domain: "jev-llm.com", name: "JEV", execution: false, keywordGoals: false, trafficGoal: false, dataOnly: true },
  { domain: "mochichatbot.com", name: "Mochi", execution: false, keywordGoals: false, trafficGoal: false, dataOnly: true },
];
/** This is a new projection configuration, not an extension of legacy four-country collectors. */
export const GROWTH_MARKETS: GrowthMarket[] = [
  { country: "US", language: "en", label: "美国 · 英语", priority: "primary", plannedShare: .35 },
  { country: "JP", language: "ja", label: "日本 · 日语", priority: "primary", plannedShare: .25 },
  { country: "BR", language: "pt-BR", label: "巴西 · 葡语", priority: "primary", plannedShare: .20 },
  { country: "SG", language: "zh-CN", label: "新加坡 · 简体中文", priority: "primary", plannedShare: .15 },
  ...[["ES", "西班牙 · 西语"], ["FR", "法国 · 法语"], ["DE", "德国 · 德语"], ["RU", "俄罗斯 · 俄语（仅规划）"], ["VN", "越南 · 越语"], ["ID", "印度尼西亚 · 印尼语"]].map(([country, label]) => ({ country, language: GROWTH_MARKET_LANGUAGES[country as keyof typeof GROWTH_MARKET_LANGUAGES], label, priority: "secondary" as const, plannedShare: null })),
  { country: "CN", language: "zh-CN", label: "中国 · 历史中文证据", priority: "legacy", plannedShare: null },
];
export const growthWordKey = (text: string) => text.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
export const growthTargetId = (site: string, keyword: string, country: string | null, language: string | null) =>
  [site, growthWordKey(keyword), country ?? "unassigned", language ?? "unassigned"].map(encodeURIComponent).join(":");
const unique = (values: string[]) => [...new Set(values)].sort();
const obj = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const stamp = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
const expectedLanguage = (country: string | null) => GROWTH_MARKETS.find(market => market.country === country)?.language ?? null;
export function growthPublicUrl(value: string, site: string): string | null {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.port && [site, `www.${site}`].includes(url.hostname) ? url.href : null; }
  catch { return null; }
}
const placeholder = isGrowthTopicPlaceholder;

export type GrowthLanguageReview = { keyword: string; country: string; classification: string; evidence?: unknown[] };
/** Locale is a request setting, not word-language evidence. Neutral model names remain unknown. */
export function reviewGrowthLanguage(keyword: string, country: string | null, language: string | null, reviews: GrowthLanguageReview[] = languageReview.rows, wordProof?: GrowthWordLanguageEvidence): { status: GrowthLanguageStatus; reason: string } {
  if (!country || !language || !expectedLanguage(country)) return { status: "unknown", reason: wordProof ? `原词语种已有 ${wordProof.language} 证据；长期目标国家/语言尚待核定，诊断查询不授主国` : "原市场或原词语种尚未核实" };
  if (expectedLanguage(country) !== language) return { status: "mismatch", reason: "原市场与登记语言不匹配；未更换国家" };
  if (wordProof && growthWordKey(wordProof.keyword) === growthWordKey(keyword)) return wordProof.language === language ? { status: "match", reason: wordProof.scope === "current-target-only" ? `用户已审核当前原词语种及来源；主国由独立市场记录确认（${wordProof.source}）` : `原诊断提案的明确原词语种证据；未据查询国家分配主国（${wordProof.source}）` } : { status: "mismatch", reason: `原词语种证据为 ${wordProof.language}，与当前市场语言不同；未迁移市场` };
  const existing = reviews.find(row => row.country === country && growthWordKey(row.keyword) === growthWordKey(keyword));
  if (existing?.classification === "CLEAR_MATCH") return { status: "match", reason: "已有原词语言逐词复核证据" };
  if (existing && /MISMATCH|WRONG|OTHER_LANGUAGE/.test(existing.classification)) return { status: "mismatch", reason: "已有原词语言复核判为不匹配" };
  const text = growthWordKey(keyword), japanese = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) || /(?:料金|使い方|おすすめ|無料|とは|比較|価格)/u.test(text), han = /\p{Script=Han}/u.test(text);
  const chinese = /(?:如何|怎么|哪个|什么|接口|模型|价格|免费|教程|生成器|人工智能|购买|租赁|比较|对比|部署|显卡|算力|开源|中文|推荐|使用|下载|在线|文档|额度|视频|图片|性能)/u.test(text);
  if (japanese) return language === "ja" ? { status: "match", reason: "原词含明确日语假名" } : { status: "mismatch", reason: "原词为日语，不能转记为当前市场排名" };
  if (chinese) return language === "zh-CN" ? { status: "match", reason: "原词含明确中文用语" } : { status: "mismatch", reason: "原词为中文，不能转记为当前市场排名" };
  if (han) return { status: "unknown", reason: "仅汉字短语无法可靠区分中日语，保留原市场待核" };
  const lexical = [
    ["en", /\b(?:how|what|which|why|best|pricing|prices?|rental|rent|versus|comparison|compare|review|reviews|tutorial|guide|examples?|alternatives?|download|free|cheapest|cheap|cost|costs|calculator|compatibility|requirements|inference|training|storage|memory|latency|throughput|hosting|cloud|open source|image generation|video generation|for developers)\b/iu],
    ["pt-BR", /\b(?:como|preço|preços|melhor|melhores|gratuito|grátis|gerador|geração|alugar|aluguel|comparação|inteligência|artificial|português|barato)\b/iu],
    ["es-ES", /\b(?:cómo|precio|precios|mejor|mejores|gratis|generador|generación|alquiler|comparación|inteligencia|español|barato)\b/iu],
    ["fr", /\b(?:comment|meilleur|meilleurs|gratuit|générateur|comparaison|tarif|français)\b/iu],
    ["de", /\b(?:wie|beste|kostenlos|vergleich|mieten|deutsch|preise)\b/iu],
    ["id", /\b(?:cara|terbaik|harga|gratis|perbandingan|sewa|pembuat)\b/iu],
    ["vi", /(?:cách|tốt nhất|miễn phí|giá|so sánh|thuê)/iu],
  ] as const;
  const matches = lexical.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  if (matches.length === 1) return matches[0] === language ? { status: "match", reason: "原词含明确本语言搜索用语" } : { status: "mismatch", reason: `原词用语为 ${matches[0]}，与当前市场语言不同` };
  return { status: "unknown", reason: "中性型号、共享术语或语种证据不足；不按查询locale推定" };
}

export type GrowthTopicInput = { id: string; text: string; active: boolean; parentId?: string | null; parentIds?: string[]; sites: string[] };
export type GrowthMembershipInput = { site: string; keywordId: string; keyword: string; active: boolean; keywordActive: boolean; topicId: string | null; topicIds?: string[]; pool: string; origin: string; targetUrls: string[]; mappingStatus?: string; sourceUrl?: string | null; marketAssignment?: unknown };
export type GrowthTaskInput = { id: string; siteDomain: string; keyword?: string | null; keywordId?: string | null; country?: string | null; language?: string | null; pageUrl?: string | null; status: string; deletedAt?: string; channel?: string; kind?: string };
export type GrowthPublicationInput = { id?: string; taskId: string; siteDomain?: string; pageUrl: string; status: string; publishedAt?: string | null; country?: string | null; language?: string; keyword?: string | null; kind?: string };
export type GrowthPlanInput = { id: string; status: string; taskIds: string[] };
export type GrowthWordLanguageEvidence = { site: string; keywordId: string; keyword: string; language: string; source: string; scope?: "current-target-only"; evidence: {text:string;start:number;end:number}[] };
export type GrowthRankEvidence = { site: string; keywordId?: string | null; keyword: string; country: string; language: string | null; rank: number | null; url: string | null; source: "serp" | "database" | "gsc"; checkedAt: string | null; exact: boolean; complete: boolean; captureState?: "ranked" | "outside100" | "incomplete" | "failed"; evidenceId?: string;
  period?: { id: string; periodKey?: string; label: string; scope: string; cohortHash: string | null; originalTargetCount: number | null; originalQueryCount: number | null } };
export type GrowthWorkspaceInput = { generatedAt: string; topics: GrowthTopicInput[]; memberships: GrowthMembershipInput[]; tasks: GrowthTaskInput[]; publications: GrowthPublicationInput[]; plans?: GrowthPlanInput[]; wordLanguageEvidence?: GrowthWordLanguageEvidence[]; inventory: { url: string; lastSeen: string }[]; ranks: GrowthRankEvidence[]; sources?: GrowthWorkspace["reconciliation"]["sources"]; languageReviews?: GrowthLanguageReview[] };

/** Input order must not let an inactive merged alias replace an active goal.
 * Aliases remain provenance, not authority to move a different keyword's rank. */
function mergeGrowthTargets(a: GrowthTarget | undefined, b: GrowthTarget): GrowthTarget {
  if (!a) return b;
  const score=(target:GrowthTarget)=>(target.membership==="formal"?target.membershipSource==="stored_formal"?100:90:target.membership==="opportunity"?50:target.sourceActive?30:10);
  const winner=score(a)>score(b)?a:score(a)<score(b)?b:String(a.keywordId).localeCompare(String(b.keywordId))<=0?a:b;
  const provenance=[...(a.memberProvenance??[]),...(b.memberProvenance??[])];
  const members=[...new Map(provenance.map(row=>[row.keywordId,row])).values()].sort((x,y)=>x.keywordId.localeCompare(y.keywordId));
  const taskRelations=mergeTaskRelations([...(a.taskRelations??[]),...(b.taskRelations??[])]);
  return {...winner,memberProvenance:members,aliasKeywordIds:members.map(row=>row.keywordId).filter(id=>id!==winner.keywordId),
    taskIds:unique([...a.taskIds,...b.taskIds]),...(taskRelations.length?{taskRelations}:{})};
}

const pageIdentity = (value: string, site: string) => { const own=growthPublicUrl(value,site);if(!own)return null;const url=new URL(own);url.hash="";return url.href; };
function mergeTaskRelations(rows: GrowthTaskRelation[]): GrowthTaskRelation[] {
  return [...new Map(rows.map(row=>[JSON.stringify([row.taskId,row.pageUrl,row.source,row.publicationId,row.sourceKeywordId,row.status]),row])).values()]
    .sort((a,b)=>a.taskId.localeCompare(b.taskId)||a.pageUrl.localeCompare(b.pageUrl)||a.source.localeCompare(b.source));
}

function assignedMarkets(value: unknown): { country: string; language: string }[] {
  const row = obj(value), primary = typeof row.primaryCountry === "string" ? row.primaryCountry : null;
  if (!primary || typeof row.language !== "string" || typeof row.evidence !== "string" || !row.evidence.trim()) return [];
  const result = [{ country: primary, language: row.language }];
  if (Array.isArray(row.secondaryMarkets)) for (const item of row.secondaryMarkets.map(obj)) {
    if (typeof item.country === "string" && typeof item.reason === "string" && item.reason.trim() && expectedLanguage(item.country)) result.push({ country: item.country, language: expectedLanguage(item.country)! });
  }
  return result;
}

/** Historical rows are reclassified in a versioned view, retaining each original
 * cohort denominator and run identity. Missing queries never become losses. */
export function reviewGrowthHistoricalPeriods(ranks: GrowthRankEvidence[], reviews?: GrowthLanguageReview[], wordLanguages: GrowthWordLanguageEvidence[] = []): GrowthHistoricalPeriod[] {
  wordLanguages = wordLanguages.filter(proof => proof.scope !== "current-target-only");
  const wordProofs=new Map(wordLanguages.map(proof=>[`${proof.site}\u0000${proof.keywordId}\u0000${growthWordKey(proof.keyword)}`,proof]));
  const groups = new Map<string, GrowthRankEvidence[]>();
  for (const rank of ranks) if (rank.source === "serp" && rank.period) groups.set(rank.period.id, [...(groups.get(rank.period.id) ?? []), rank]);
  return [...groups].map(([id, rows]) => {
    const period = rows[0].period!, byTarget = new Map<string, GrowthRankEvidence[]>();
    for (const row of rows) { const key = growthTargetId(row.site, row.keyword, row.country, row.language); byTarget.set(key, [...(byTarget.get(key) ?? []), row]); }
    const statuses = [...byTarget.values()].map(items => ({ language: reviewGrowthLanguage(items[0].keyword, items[0].country, items[0].language, reviews,items[0].keywordId?wordProofs.get(`${items[0].site}\u0000${items[0].keywordId}\u0000${growthWordKey(items[0].keyword)}`):undefined), ranked: items.some(row => row.exact && row.complete && row.rank !== null && row.rank >= 1 && row.rank <= 100) }));
    return { id, label: period.label, scope: period.scope, cohortHash: period.cohortHash, originalTargetCount: period.originalTargetCount, originalQueryCount: period.originalQueryCount,
      checkedQueries: new Set(rows.filter(row => row.exact && row.complete).map(row => `${row.country}\u0000${row.language}\u0000${growthWordKey(row.keyword)}`)).size,
      matchedRankedTargets: statuses.filter(row => row.language.status === "match" && row.ranked).length, unknownLanguageTargets: statuses.filter(row => row.language.status === "unknown").length, mismatchedLanguageTargets: statuses.filter(row => row.language.status === "mismatch").length,
      comparable: false as const, rawSnapshotPreserved: true as const };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

/** Builds an immutable, site/market-specific view from saved evidence only. */
export function buildGrowthWorkspace(input: GrowthWorkspaceInput, selectedSite?: string): GrowthWorkspace {
  const sites = GROWTH_SITES.map(site => ({ ...site })), goalSites = new Set(sites.filter(site => site.keywordGoals).map(site => site.domain));
  const now = stamp(input.generatedAt), topicIndex = new Map(input.topics.map(topic => [topic.id, topic]));
  const liveTasks = input.tasks.filter(task => !task.deletedAt && task.channel !== "github" && task.channel !== "product" && goalSites.has(task.siteDomain));
  const inventory = new Map(input.inventory.map(item => [item.url, item.lastSeen]));
  const targets = new Map<string, GrowthTarget>();
  const taskIndex = new Map<string, GrowthTaskInput[]>(), memberIndex = new Map<string, GrowthMembershipInput>(), rankIndex = new Map<string, GrowthRankEvidence[]>(), publicationIndex = new Map<string, GrowthPublicationInput[]>();
  const ranksByMember=new Map<string,GrowthRankEvidence[]>();
  const wordIdentity = (site: string, keyword: string) => `${site}\u0000${growthWordKey(keyword)}`;
  const memberById=new Map(input.memberships.map(member=>[`${member.site}\u0000${member.keywordId}`,member]));
  const wordProofs=new Map((input.wordLanguageEvidence??[]).map(proof=>[`${proof.site}\u0000${proof.keywordId}\u0000${growthWordKey(proof.keyword)}`,proof]));
  const wordProof=(site:string,keywordId:string|null|undefined,keyword:string)=>keywordId?wordProofs.get(`${site}\u0000${keywordId}\u0000${growthWordKey(keyword)}`):undefined;
  const realTopics = (row: GrowthMembershipInput) => [...new Set([...(row.topicId ? [row.topicId] : []), ...unique(row.topicIds ?? [])])].map(id => topicIndex.get(id)).filter((topic): topic is GrowthTopicInput => Boolean(topic?.active && !placeholder(topic.text) && topic.sites.includes(row.site)));
  const memberScore=(member:GrowthMembershipInput)=>member.active&&member.keywordActive?(member.pool==="FORMAL"&&realTopics(member).length?100:member.pool==="RESEARCH"?50:30):10;
  const plansByTask=new Map<string,string[]>();
  for(const plan of input.plans??[])if(["scheduled","reviewed"].includes(plan.status))for(const taskId of plan.taskIds)plansByTask.set(taskId,unique([...(plansByTask.get(taskId)??[]),plan.id]));
  for (const task of liveTasks) if (task.keyword) { const key = wordIdentity(task.siteDomain, task.keyword); taskIndex.set(key, [...(taskIndex.get(key) ?? []), task]); }
  for (const member of input.memberships) {const key=wordIdentity(member.site,member.keyword),current=memberIndex.get(key);if(!current||memberScore(member)>memberScore(current)||memberScore(member)===memberScore(current)&&member.keywordId.localeCompare(current.keywordId)<0)memberIndex.set(key,member);}
  for (const row of input.ranks) { const key = growthTargetId(row.site, row.keyword, row.country, row.language); rankIndex.set(key, [...(rankIndex.get(key) ?? []), row]);if(row.keywordId){const memberKey=`${row.site}\u0000${row.keywordId}\u0000${growthWordKey(row.keyword)}`;ranksByMember.set(memberKey,[...(ranksByMember.get(memberKey)??[]),row]);} }
  for (const row of input.publications) publicationIndex.set(row.taskId, [...(publicationIndex.get(row.taskId) ?? []), row]);
  // Only explicit member->page and original task/publication->same page edges
  // qualify. Topic similarity and observed rank URLs do not prove task intent.
  // This index must never participate in market fallback or formal commitments.
  const pageTasks=new Map<string,{task:GrowthTaskInput;pageUrl:string;source:"task_page"|"publication";publicationId?:string;country:string|null;language:string|null}[]>();
  const addPageTask=(task:GrowthTaskInput,value:string,source:"task_page"|"publication",country:string|null,language:string|null,publicationId?:string)=>{
    const pageUrl=pageIdentity(value,task.siteDomain);if(!pageUrl)return;
    const key=`${task.siteDomain}\u0000${pageUrl}`;pageTasks.set(key,[...(pageTasks.get(key)??[]),{task,pageUrl,source,country,language,...(publicationId?{publicationId}:{})}]);
  };
  for(const task of liveTasks){
    if(task.pageUrl)addPageTask(task,task.pageUrl,"task_page",task.country??null,task.language??null);
    for(const publication of publicationIndex.get(task.id)??[]){
      if(!publication.id||publication.siteDomain&&publication.siteDomain!==task.siteDomain||!["published","verified"].includes(publication.status)||stamp(publication.publishedAt)<=0||stamp(publication.publishedAt)>now)continue;
      // Conflicting publication scope is not permission to move an original task.
      if(task.country&&publication.country&&task.country!==publication.country||task.language&&publication.language&&task.language!==publication.language)continue;
      addPageTask(task,publication.pageUrl,"publication",task.country??publication.country??null,task.language??publication.language??null,publication.id);
    }
  }
  const matchingTasks = (site: string, keyword: string) => taskIndex.get(wordIdentity(site, keyword)) ?? [];
  for (const row of input.memberships) {
    if (!goalSites.has(row.site) || isOwnedBrandKeyword(row.keyword)) continue;
    const topics = realTopics(row), topic = topics[0] ?? null, tasks = matchingTasks(row.site, row.keyword).filter(task=>!task.keywordId||task.keywordId===row.keywordId);
    const proofs:NonNullable<GrowthTarget["planningProofs"]>=[];
    const exactContentTasks=tasks.filter(task=>task.keywordId===row.keywordId&&["blog","landing","cluster","optimization"].includes(task.kind??"")&&task.country&&task.language&&expectedLanguage(task.country)===task.language);
    for(const task of exactContentTasks){
      for(const planId of plansByTask.get(task.id)??[])proofs.push({kind:"formal_plan",id:planId,taskId:task.id,country:task.country!,language:task.language!});
      for(const publication of publicationIndex.get(task.id)??[])if(publication.id&&publication.siteDomain===row.site&&publication.country===task.country&&publication.language===task.language&&publication.keyword&&growthWordKey(publication.keyword)===growthWordKey(row.keyword)&&["source_blog","landing","cluster","optimization"].includes(publication.kind??"")&&["published","verified"].includes(publication.status)&&stamp(publication.publishedAt)>0&&stamp(publication.publishedAt)<=now&&growthPublicUrl(publication.pageUrl,row.site))proofs.push({kind:"publication",id:publication.id,taskId:task.id,country:task.country!,language:task.language!});
    }
    const derived=Boolean(row.pool==="RESEARCH"&&topic&&proofs.length);
    const membership = !row.active || !row.keywordActive ? "review" : row.pool === "FORMAL" && topic || derived ? "formal" : row.pool === "RESEARCH" ? exactContentTasks.length&&topic?"review":"opportunity" : "review";
    const membershipSource:GrowthTarget["membershipSource"]=membership==="formal"?derived?"committed_task":"stored_formal":membership==="opportunity"?"research":"review";
    const markets = assignedMarkets(row.marketAssignment);
    // Explicit normal assignments win. Diagnostic query locales are never a
    // fallback; only the original task/real formal commitment can fill a gap.
    if(!markets.length)for (const task of derived?tasks.filter(task=>proofs.some(proof=>proof.taskId===task.id)):tasks) if (task.country && task.language && !markets.some(market => market.country === task.country && market.language === task.language)) markets.push({ country: task.country, language: task.language });
    const scopes: { country: string | null; language: string | null }[] = markets.length ? markets : [{ country: null, language: null }];
    const memberPages=unique([...row.targetUrls,...(row.sourceUrl?[row.sourceUrl]:[])].flatMap(value=>pageIdentity(value,row.site)??[]));
    for (const scope of scopes) {
      const scopedTasks = tasks.filter(task => scope.country && scope.language && task.country === scope.country && task.language === scope.language);
      const taskRelations=mergeTaskRelations(memberPages.flatMap(pageUrl=>(pageTasks.get(`${row.site}\u0000${pageUrl}`)??[]).flatMap(link=>{
        if(scopedTasks.some(task=>task.id===link.task.id))return [];
        if(scope.country&&link.country&&scope.country!==link.country||scope.language&&link.language&&scope.language!==link.language)return [];
        const confirmed=Boolean(scope.country&&scope.language&&link.country===scope.country&&link.language===scope.language);
        return [{taskId:link.task.id,originalKeyword:link.task.keyword??null,country:link.country,language:link.language,pageUrl,source:link.source,...(link.publicationId?{publicationId:link.publicationId}:{}),sourceKeywordId:row.keywordId,status:confirmed?"confirmed" as const:"candidate" as const,
          reason:confirmed?"明确关联同一官网页面，原任务或该页发布回执市场、语言一致；保留原任务主词与ID":"同页原任务线索；目标或原任务市场语言待核，不授长期主国或执行批准"}];
      })));
      const relatedTaskIds=new Set(taskRelations.filter(link=>link.status==="confirmed").map(link=>link.taskId));
      const linkedTasks=[...scopedTasks,...liveTasks.filter(task=>relatedTaskIds.has(task.id))];
      const plannedUrls = unique([...row.targetUrls, ...scopedTasks.flatMap(task => task.pageUrl ? [task.pageUrl] : [])].flatMap(url => growthPublicUrl(url, row.site) ?? []));
      const publishedUrls = unique([...plannedUrls.filter(url => inventory.has(url)), ...scopedTasks.flatMap(task => publicationIndex.get(task.id) ?? []).filter(publication => ["published", "verified"].includes(publication.status) && stamp(publication.publishedAt) > 0 && stamp(publication.publishedAt) <= now && (!publication.language || publication.language === scope.language)).flatMap(publication => growthPublicUrl(publication.pageUrl, row.site) ?? []),...taskRelations.filter(link=>link.status==="confirmed"&&link.source==="publication").map(link=>link.pageUrl)]);
      const originalLanguage=wordProof(row.site,row.keywordId,row.keyword);
      const language = reviewGrowthLanguage(row.keyword, scope.country, scope.language, input.languageReviews,originalLanguage);
      const id = growthTargetId(row.site, row.keyword, scope.country, scope.language);
      const reason = membership === "formal" ? derived?"原内容任务已进入真实正式计划或有原市场语种源交付；只读归入已承诺目标，保留DB研究池历史":"站点正式词库且归属已核实的本站 TopicMap 话题" : membership === "opportunity" ? "研究／发现词尚未进入正式 TopicMap；保留已有结果供归属审核" : !row.active || !row.keywordActive ? "原词库条目已停用，保留历史待核" : exactContentTasks.length&&topic?"已有原内容任务关联，历史正式计划或原市场语种源交付仍待核；不据缺少计划断言未规划":"话题归属未核实或为发现占位话题，不计正式目标";
      const candidate:GrowthTarget={ id, keywordId: row.keywordId, site: row.site, topicId: topic?.id ?? null, topicName: topic?.text ?? null, relatedTopicIds: topics.map(topic => topic.id), keyword: row.keyword, ...scope, membership,
        sourcePool:row.pool,sourceActive:row.active&&row.keywordActive,membershipSource,wordLanguage:originalLanguage?.language??null,planningProofs:proofs.filter(proof=>proof.country===scope.country&&proof.language===scope.language),memberProvenance:[{keywordId:row.keywordId,keyword:row.keyword,pool:row.pool,active:row.active&&row.keywordActive}],aliasKeywordIds:[],
        pageState: publishedUrls.length ? "published" : plannedUrls.length ? "planned" : "unmapped", publishedUrls, plannedUrls,
        ...growthContentProgress(publishedUrls, membership, linkedTasks, plansByTask),
        rank: null, rankUrl: null, rankSource: null, checkedAt: null, languageStatus: language.status, languageReason: language.reason,
        captureState: "unqueried", rankEligible: false, observationEligible: false, monitoringEligible: false, taskIds: unique(linkedTasks.map(task => task.id)),...(taskRelations.length?{taskRelations}:{}), reason };
      targets.set(id,mergeGrowthTargets(targets.get(id),candidate));
    }
  }
  // Observed words absent from the formal plan remain visible as opportunities.
  // An observation in Japan never assigns or migrates the US formal target.
  for (const row of input.ranks) {
    if (!goalSites.has(row.site) || isOwnedBrandKeyword(row.keyword)) continue;
    const id = growthTargetId(row.site, row.keyword, row.country, row.language);
    if (targets.has(id)) continue;
    const byId=row.keywordId?memberById.get(`${row.site}\u0000${row.keywordId}`):undefined;
    const membership = row.keywordId?byId&&growthWordKey(byId.keyword)===growthWordKey(row.keyword)?byId:undefined:memberIndex.get(wordIdentity(row.site, row.keyword));
    const topics = membership ? realTopics(membership) : [], topic = topics[0] ?? null;
    const originalLanguage=wordProof(row.site,row.keywordId??membership?.keywordId,row.keyword);
    const language = reviewGrowthLanguage(row.keyword, row.country, row.language, input.languageReviews,originalLanguage);
    targets.set(id, { id, keywordId: row.keywordId ?? membership?.keywordId ?? null, site: row.site, keyword: row.keyword, country: row.country, language: row.language, topicId: topic?.id ?? null, topicName: topic?.text ?? null, relatedTopicIds: topics.map(topic => topic.id),
      membership: language.status === "match" ? "opportunity" : "review", sourcePool:membership?.pool,membershipSource:language.status==="match"?"research":"review",wordLanguage:originalLanguage?.language??null,pageState: row.url && inventory.has(row.url) && growthPublicUrl(row.url, row.site) ? "published" : "unmapped",
      publishedUrls: row.url && inventory.has(row.url) && growthPublicUrl(row.url, row.site) ? [row.url] : [], plannedUrls: [], workState: "unknown", rank: null, rankUrl: null, rankSource: null, checkedAt: null,
      languageStatus: language.status, languageReason: language.reason, captureState: "unqueried", rankEligible: false, observationEligible: false, monitoringEligible: false, taskIds: [], reason: "已存排名或诊断词；尚无该站点／原词／市场／语言的正式目标分配" });
  }
  for (const target of targets.values()) {
    const evidence = (rankIndex.get(target.id) ?? []).filter(row => (!row.keywordId||!target.keywordId||row.keywordId===target.keywordId) && (!row.url || growthPublicUrl(row.url, target.site)) && (!row.checkedAt || stamp(row.checkedAt) <= now));
    const exact = evidence.filter(row => row.source === "serp" && row.exact && row.checkedAt).sort((a, b) => stamp(b.checkedAt) - stamp(a.checkedAt));
    // A newer incomplete receipt is visible and cannot turn an old positive into a fresh result.
    const latestTime = exact[0]?.checkedAt, latest = exact.filter(row => row.checkedAt === latestTime);
    const precise = latest.filter(row => row.complete), positives = precise.filter(row => row.rank !== null && row.rank >= 1 && row.rank <= 100).sort((a, b) => a.rank! - b.rank!);
    const fallback = evidence.filter(row => row.source !== "serp" && row.rank !== null && row.rank >= 1 && row.rank <= 100).sort((a, b) => stamp(b.checkedAt) - stamp(a.checkedAt) || a.rank! - b.rank!)[0];
    const chosen = positives[0] ?? (latest.length ? precise[0] ?? latest[0] : fallback);
    if (chosen) {
      target.rank = positives[0]?.rank ?? (latest.length ? null : fallback?.rank ?? null); target.rankUrl = target.rank !== null ? chosen.url : null;
      target.rankSource = chosen.source; target.checkedAt = chosen.checkedAt;
      target.captureScope = chosen.period?.scope ?? null; target.capturePeriodKey = chosen.period?.periodKey ?? null; target.captureRunId = chosen.period?.id ?? null;
      target.captureState = latest.length ? positives.length ? "ranked" : precise.length ? "outside100" : chosen.captureState ?? "incomplete" : "ranked";
      target.rankEligible = Boolean(positives.length && target.languageStatus === "match" && stamp(chosen.checkedAt) <= now && now - stamp(chosen.checkedAt) <= 14 * 86400000);
      target.observationEligible = Boolean(precise.length && target.languageStatus === "match" && stamp(chosen.checkedAt) <= now && now - stamp(chosen.checkedAt) <= 14 * 86400000);
    }
    target.monitoringEligible = target.membership === "formal" && target.pageState === "published" && target.languageStatus === "match" && Boolean(target.country && target.language && target.keywordId) && target.country !== "CN" && target.country !== "RU" && !isOwnedBrandKeyword(target.keyword) && !/(?:^|\s)\w+:/u.test(target.keyword);
    if(target.membership==="formal"&&(!target.country||!target.language)){
      const related=(ranksByMember.get(`${target.site}\u0000${target.keywordId}\u0000${growthWordKey(target.keyword)}`)??[]).filter(row=>row.rank!==null&&row.rank>=1&&row.rank<=100&&row.url&&growthPublicUrl(row.url,target.site)&&stamp(row.checkedAt)>0&&stamp(row.checkedAt)<=now&&(row.source!=="serp"||row.exact&&row.complete)).sort((a,b)=>stamp(b.checkedAt)-stamp(a.checkedAt)||a.rank!-b.rank!);
      const observations=[...new Map(related.map(row=>[`${row.country}:${row.language}:${row.source}:${row.url}:${row.checkedAt}`,{country:row.country,language:row.language,rank:row.rank!,url:row.url!,source:row.source,checkedAt:row.checkedAt,languageStatus:reviewGrowthLanguage(row.keyword,row.country,row.language,input.languageReviews,wordProof(row.site,row.keywordId,row.keyword)).status}])).values()];
      target.relatedObservationCount=observations.length;target.relatedObservations=observations.slice(0,10);
    }
  }
  const all = [...targets.values()].filter(target => !selectedSite || target.site === selectedSite).sort((a, b) => a.site.localeCompare(b.site) || (a.topicName ?? "~").localeCompare(b.topicName ?? "~") || a.keyword.localeCompare(b.keyword) || (a.country ?? "").localeCompare(b.country ?? ""));
  const topics: GrowthTopic[] = input.topics.filter(topic => topic.active && !placeholder(topic.text)).flatMap(topic => topic.sites.filter(site => goalSites.has(site) && (!selectedSite || site === selectedSite)).map(site => {
    const rows = all.filter(target => target.site === site && (target.topicId === topic.id || target.relatedTopicIds?.includes(topic.id))), formal = rows.filter(target => target.membership === "formal" && target.topicId === topic.id);
    const marketKeys = unique(formal.map(target => `${target.country ?? ""}|${target.language ?? ""}`));
    const counts = (items: GrowthTarget[]) => ({ formalCount: items.length, publishedCount: items.filter(target => target.pageState === "published").length, rankedCount: items.filter(target => target.rankEligible && target.rank !== null && target.rank <= 100).length, top50Count: items.filter(target => target.rankEligible && target.rank !== null && target.rank <= 50).length });
    return { id: `${site}:${topic.id}`, topicId: topic.id, site, name: topic.text, parentIds: unique([...(topic.parentIds ?? []), ...(topic.parentId ? [topic.parentId] : [])]), targetIds: rows.map(target => target.id), relatedCount: rows.filter(target => target.topicId !== topic.id).length, ...counts(formal), markets: marketKeys.map(key => { const [country, language] = key.split("|"); return { country: country || null, language: language || null, ...counts(formal.filter(target => target.country === (country || null) && target.language === (language || null))) }; }) };
  })).sort((a, b) => a.site.localeCompare(b.site) || a.name.localeCompare(b.name));
  const formal = all.filter(target => target.membership === "formal"), ranked = formal.filter(target => target.rankEligible && target.rank !== null && target.rank <= 100);
  const eligible = formal.filter(target => target.monitoringEligible), reused = eligible.filter(target => target.observationEligible && target.checkedAt && target.rankSource === "serp" && ["ranked", "outside100"].includes(target.captureState) && now - stamp(target.checkedAt) <= 14 * 86400000 && stamp(target.checkedAt) <= now);
  const reusedIds = new Set(reused.map(target => target.id));
  const queryGroups = new Map<string, GrowthMonitoringQuery>();
  for (const target of eligible.filter(target => !reusedIds.has(target.id))) {
    // A SERP response contains every site's positions: charge the same exact
    // word/market/language once, while preserving each independent site target.
    const key = [target.country, target.language, growthWordKey(target.keyword)].map(value => encodeURIComponent(value!)).join(":"), existing = queryGroups.get(key);
    if (existing) { existing.targetIds.push(target.id); existing.urls = unique([...existing.urls, ...target.publishedUrls]); existing.sites = unique([...(existing.sites ?? [existing.site]), target.site]); }
    else queryGroups.set(key, { id: `query:${key}`, site: target.site, sites: [target.site], keyword: target.keyword, country: target.country!, language: target.language!, targetIds: [target.id], urls: target.publishedUrls, reason: "已建页正式目标缺少近14天同词同市场完整SERP；同查询跨站复用，仅列待审清单", approved: false, maxCostMicros: /(?:^|\s)\w+:/u.test(target.keyword) ? null : 6000 });
  }
  const queries = [...queryGroups.values()];
  const reviewRows = input.ranks.map(row => reviewGrowthLanguage(row.keyword, row.country, row.language, input.languageReviews,wordProof(row.site,row.keywordId,row.keyword)));
  return { version: "growth-v1.5", generatedAt: input.generatedAt, sites, markets: GROWTH_MARKETS.map(market => ({ ...market })), topics, targets: all, opportunities: all.filter(target => target.membership !== "formal"),
    reconciliation: { formalCount: formal.length, opportunityCount: all.filter(target => target.membership === "opportunity").length, reviewCount: all.filter(target => target.membership === "review").length, totalCount: all.length, uniqueKeywordCount: new Set(all.map(target => growthWordKey(target.keyword))).size, siteKeywordCount: new Set(all.map(target => `${target.site}\u0000${growthWordKey(target.keyword)}`)).size,
      rankedCount: ranked.length, top50Count: ranked.filter(target => target.rank! <= 50).length, publishedCount: formal.filter(target => target.pageState === "published").length,
      countryCounts: unique(ranked.flatMap(target => target.country ?? [])).map(country => ({ country, count: ranked.filter(target => target.country === country).length, share: ranked.length ? ranked.filter(target => target.country === country).length / ranked.length : null })),
      historicalLanguageReview: { version: "word-language-view-v2", rawSnapshotsPreserved: true, rows: reviewRows.length, matched: reviewRows.filter(row => row.status === "match").length, mismatched: reviewRows.filter(row => row.status === "mismatch").length, unknown: reviewRows.filter(row => row.status === "unknown").length, comparableTrend: false, reason: "只读复核全部已存证据；原历史期次及采集分母不同，不连成可比涨跌趋势，不将CN转记SG；原诊断span仅证明语种，不授长期主国", periods: reviewGrowthHistoricalPeriods(input.ranks, input.languageReviews,input.wordLanguageEvidence) },
      sources: input.sources ?? [], notes: ["目标身份按站点、原词、市场、语言保留；最佳国家不替代各国计数。", "未建页、未核语言、未采集及来源未知不填0；未冻结季度分母。", "数据库/GSC为来源证据，只有近14天完整同口径SERP进入当前抢占统计。", "次要市场合计规划占比5%；不自动分配给每个次要市场。"] },
    monitoringQuote: { approved: false, paidRequests: 0, queryCount: queries.length, reusedCount: reused.length, heldCount: formal.filter(target => target.pageState === "published" && !target.monitoringEligible).length, maxCostMicros: queries.some(query => query.maxCostMicros === null) ? null : queries.reduce((sum, query) => sum + (query.maxCostMicros ?? 0), 0), queries, reason: "只复用已存结果；价格按原100深度常规单次上限估算，未提交。清单及总额仍需当次批准，新增市场不自动启用采集。" } };
}

/** A continuation proposal, never a provider request or authorization to paginate. */
export function planGrowthDiscoveryPagination(input: { site: string; country: string; language: string; returned: number; total: number | null; limit: number; offset: number; complete: boolean; unitCostMicros?: number | null }) {
  const valid = input.limit > 0 && Number.isSafeInteger(input.limit) && Number.isSafeInteger(input.offset) && input.offset >= 0 && Number.isSafeInteger(input.returned) && input.returned >= 0 && input.returned <= input.limit;
  const totalKnown = input.total !== null && Number.isSafeInteger(input.total) && input.total >= input.offset + input.returned;
  const remaining = valid && totalKnown ? Math.max(0, input.total! - input.offset - input.returned) : null;
  const pages = remaining === null ? null : Math.ceil(remaining / input.limit);
  return { ...input, valid, returnedComplete: valid && totalKnown && remaining === 0 && input.complete,
    nextOffset: valid && input.returned > 0 && remaining !== 0 ? input.offset + input.returned : null, remaining, pages,
    maxCostMicros: pages !== null && input.unitCostMicros != null ? pages * input.unitCostMicros : null,
    approved: false as const, paidRequests: 0 as const, reason: !valid ? "已存分页回执无效，先核对" : input.returned === 0 && remaining !== 0 ? "空页未推进游标，先核对，不能重复收费翻页" : remaining === null ? "供应商总量未知，不能声明全量或预授权翻页" : remaining > 0 ? "已存回执截断；新增分页及费用须单独审核" : "已存分页覆盖到声明总量；未触发新请求" };
}
