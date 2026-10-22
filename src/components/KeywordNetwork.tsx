"use client";
import { useMemo, useState } from "react";
import { KeywordGraph } from "@/components/KeywordGraph";
import { useDashboard } from "@/components/useDashboard";
import { DISPLAY_BUCKETS } from "@/lib/rank-display";
import { keywordGraphKeywords } from "@/lib/keyword-graph-data";
import { REGIONS, type SearchRegionCode } from "@/lib/seo";

export function KeywordNetwork({ region = "all" }: { region?: "all" | SearchRegionCode }) {
  const { data, loading, error, refresh } = useDashboard("all", "dataforseo_serp");
  const [search, setSearch] = useState("");
  const [crossLanguage, setCrossLanguage] = useState(false);
  const keywords = useMemo(() => {
    const query = search.trim().normalize("NFKC").toLowerCase();
    return keywordGraphKeywords(data?.keywords ?? [], region, crossLanguage).filter(keyword =>
      !query || `${keyword.text} ${keyword.topicText ?? ""} ${keyword.siteName ?? ""}`.normalize("NFKC").toLowerCase().includes(query));
  }, [data?.keywords, region, crossLanguage, search]);
  return <section className="overviewGrid">
    {error ? <div className="loadError" role="alert"><span>{error}</span><button type="button" onClick={refresh}>重新加载</button></div> : null}
    <article className="graphPanel">
      <div className="panelHeader"><div><h2>业务词库关系图</h2><p>圆点越大，月搜索量越高；颜色表示{region === "all" ? "四国最佳" : REGIONS[region].label}排名。缩放或悬停查看关联。</p></div>
        <div className="graphTools"><label className="searchField graphSearch"><input aria-label="搜索图中关键词" placeholder="搜索图中关键词…" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
      </div>
      <p className="chartNote">{data ? keywords.length.toLocaleString() : "—"} 个{search ? "匹配" : "业务"}关键词 · 已去重 · 大小按{region === "all" ? "四国已知月搜索量合计" : `${REGIONS[region].label}月搜索量`}缩放（对数压缩）</p>
      <div className="rankLegend">{DISPLAY_BUCKETS.map(bucket => <span key={bucket.key}><i style={{ background: bucket.color }} />{bucket.key === "NOT_FOUND" ? "尚无实测排名记录" : bucket.range}</span>)}</div>
      {region !== "all" ? <label className="chartNote"><input type="checkbox" checked={crossLanguage} onChange={event => setCrossLanguage(event.target.checked)} /> 包含在该国有数据的跨语种词</label> : null}
      {loading ? <div className="loadingState">正在加载关键词…</div> : error && !data ? <div className="loadingState">词库读取失败，请点击上方「重新加载」</div> : <KeywordGraph keywords={keywords} region={region} />}
    </article>
  </section>;
}
