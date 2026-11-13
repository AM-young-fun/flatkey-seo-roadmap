"use client";

import { ReportLoading } from "./ReportLoading";
import { useEffect, useMemo, useState } from "react";
import { KeywordGraph } from "@/components/KeywordGraph";
import { useDashboard } from "@/components/useDashboard";
import { DISPLAY_BUCKETS, displayBucket } from "@/lib/rank-display";
import { keywordGraphRank } from "@/lib/keyword-graph-data";
import { OVERVIEW_PAGE_MODULES, overviewKeywordScope, overviewModule, type OverviewPageModule } from "@/lib/seo-overview-scope";
import { REGIONS, type SearchRegionCode } from "@/lib/seo";
import { UiSelect } from "./UiSelect";

export function KeywordNetwork({ region = "all", showModuleFilter = false, module: controlledModule }: { region?: "all" | SearchRegionCode; showModuleFilter?: boolean; module?: OverviewPageModule }) {
  const { data, loading, error, refresh } = useDashboard("all", "dataforseo_serp");
  const [crossLanguage, setCrossLanguage] = useState(false);
  const [rankBucket, setRankBucket] = useState<typeof DISPLAY_BUCKETS[number]["key"] | null>(null);
  const [module, setModule] = useState<OverviewPageModule>("all");
  useEffect(() => {
    if (!showModuleFilter) return;
    const read = () => setModule(overviewModule(new URLSearchParams(location.search).get("module")));
    read(); addEventListener("popstate", read);
    return () => removeEventListener("popstate", read);
  }, [showModuleFilter]);
  const changeModule = (value: string) => {
    const next = overviewModule(value), params = new URLSearchParams(location.search);
    if (next === "all") params.delete("module"); else params.set("module", next);
    history.pushState(null, "", location.pathname + (params.size ? "?" + params : "") + location.hash);
    dispatchEvent(new PopStateEvent("popstate"));
  };
  const activeModule = controlledModule ?? (showModuleFilter ? module : "all");
  const { keywords } = useMemo(() => overviewKeywordScope(data?.usingDemoData ? [] : data?.keywords ?? [], region, activeModule, crossLanguage),
    [data?.keywords, data?.usingDemoData, region, activeModule, crossLanguage]);
  const hasRealData = data && !data.usingDemoData;
  const visibleKeywords = useMemo(() => rankBucket === null ? keywords : keywords.filter(keyword =>
    displayBucket(keywordGraphRank(keyword, region)?.rank).key === rankBucket), [keywords, region, rankBucket]);
  const rankScope = region === "all" ? "四国最佳排名" : `${REGIONS[region].label}排名`;
  return <section className="overviewGrid">
    {error ? <div className="loadError" role="alert"><span>{error}</span><button type="button" onClick={refresh}>重新加载</button></div> : null}
    <article className="graphPanel">
      <div className="panelHeader">
        <div>
          <h2>业务词库关系图</h2>
          <p>{hasRealData ? `${visibleKeywords.length.toLocaleString("zh-CN")}${rankBucket === null ? "" : ` / ${keywords.length.toLocaleString("zh-CN")}`} 个业务关键词 · ` : ""}{rankScope} · 最新已保存排名</p>
        </div>
        {showModuleFilter ? <UiSelect aria-label="关系图页面模块" value={module} onChange={changeModule} options={OVERVIEW_PAGE_MODULES.map(([value, label]) => ({ value, label }))} /> : null}
      </div>
      <div className="rankLegend" role="group" aria-label={`${rankScope}筛选`}>
        {DISPLAY_BUCKETS.map(bucket => <button type="button" key={bucket.key} aria-pressed={rankBucket === bucket.key}
          onClick={() => setRankBucket(current => current === bucket.key ? null : bucket.key)}>
          <i style={{ background: bucket.color }} />{bucket.key === "NOT_FOUND" ? "无有效前 100 名次" : bucket.range}
        </button>)}
        {rankBucket !== null ? <button type="button" onClick={() => setRankBucket(null)}>清除排名筛选</button> : null}
      </div>
      {region !== "all" ? <label className="chartNote"><input type="checkbox" checked={crossLanguage} onChange={event => setCrossLanguage(event.target.checked)} /> 包含在该国有数据的跨语种词</label> : null}
      {loading ? <div className="loadingState"><ReportLoading label="正在加载关键词" compact /></div> : error && !data ? <div className="loadingState">词库读取失败，请点击上方「重新加载」</div> : data?.usingDemoData ? <div className="emptyGraph">真实词库待接通，未将演示数据作为效果。</div> : <KeywordGraph keywords={visibleKeywords} region={region} />}
    </article>
  </section>;
}
