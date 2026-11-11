"use client";
import { useEffect, useMemo, useState } from "react";
import { KeywordGraph } from "@/components/KeywordGraph";
import { useDashboard } from "@/components/useDashboard";
import { DISPLAY_BUCKETS } from "@/lib/rank-display";
import { OVERVIEW_PAGE_MODULES, overviewKeywordScope, overviewModule, type OverviewPageModule } from "@/lib/seo-overview-scope";
import { REGIONS, type SearchRegionCode } from "@/lib/seo";
import { UiSelect } from "./UiSelect";

export function KeywordNetwork({ region = "all", showModuleFilter = false, module: controlledModule }: { region?: "all" | SearchRegionCode; showModuleFilter?: boolean; module?: OverviewPageModule }) {
  const { data, loading, error, refresh } = useDashboard("all", "dataforseo_serp");
  const [crossLanguage, setCrossLanguage] = useState(false);
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
  const { keywords, unknownCount } = useMemo(() => overviewKeywordScope(data?.usingDemoData ? [] : data?.keywords ?? [], region, activeModule, crossLanguage),
    [data?.keywords, data?.usingDemoData, region, activeModule, crossLanguage]);
  const hasRealData = data && !data.usingDemoData;
  const rankScope = region === "all" ? "四国最佳排名" : `${REGIONS[region].label}排名`;
  const volumeScope = region === "all" ? "四国已知月搜索量合计" : `${REGIONS[region].label}月搜索量`;
  return <section className="overviewGrid">
    {error ? <div className="loadError" role="alert"><span>{error}</span><button type="button" onClick={refresh}>重新加载</button></div> : null}
    <article className="graphPanel">
      <div className="panelHeader">
        <div>
          <h2>业务词库关系图</h2>
          <p>{hasRealData ? `${keywords.length.toLocaleString("zh-CN")} 个业务关键词 · ` : ""}{rankScope} · 最新已保存排名</p>
        </div>
        {showModuleFilter ? <UiSelect aria-label="关系图页面模块" value={module} onChange={changeModule} options={OVERVIEW_PAGE_MODULES.map(([value, label]) => ({ value, label }))} /> : null}
      </div>
      {showModuleFilter ? <p className="chartNote">页面模块仅筛选此图{hasRealData ? ` · ${unknownCount.toLocaleString("zh-CN")} 个词尚未归属模块` : ""}</p> : null}
      {controlledModule !== undefined && hasRealData && unknownCount > 0 ? <p className="chartNote">{unknownCount.toLocaleString("zh-CN")} 个词尚未登记目标页，保留在「尚未归属模块」中。</p> : null}
      <div className="rankLegend" aria-label={`${rankScope}图例`}>{DISPLAY_BUCKETS.map(bucket => <span key={bucket.key}><i style={{ background: bucket.color }} />{bucket.key === "NOT_FOUND" ? "无有效前 100 名次" : bucket.range}</span>)}</div>
      {region !== "all" ? <label className="chartNote"><input type="checkbox" checked={crossLanguage} onChange={event => setCrossLanguage(event.target.checked)} /> 包含在该国有数据的跨语种词</label> : null}
      <details className="chartNote">
        <summary>图示与统计口径</summary>
        <p>词库范围为 Flatkey、RackRate、ModelFit。Mochi、JEV 尚未接入。关键词已去重，点面积按{volumeScope}缩放，极小值以最小实心点显示。</p>
        <p>实心点在圆盘内排布，连线表示父子词或同话题关系。颜色对应关键词的本站排名，目标页的排名需单独核查。悬停可核对状态与关联，滚动可缩放。</p>
        <p>关系图使用最新已保存的 SERP 结果。上榜词趋势包含该国已实测的跨语种词，关系图默认展示该国语言。</p>
        {showModuleFilter ? <p>模块按登记目标页归属，同一个词可关联多个模块。GA4 流量日期仅作用于自然搜索流量，上榜词趋势使用实际排名采集期。</p> : null}
      </details>
      {loading ? <div className="loadingState">正在加载关键词…</div> : error && !data ? <div className="loadingState">词库读取失败，请点击上方「重新加载」</div> : data?.usingDemoData ? <div className="emptyGraph">真实词库待接通，未将演示数据作为效果。</div> : <KeywordGraph keywords={keywords} region={region} />}
    </article>
  </section>;
}
