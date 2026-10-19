"use client";
import { Select } from "antd";
import { REGIONS, REGION_CODES, type SearchRegionCode } from "@/lib/seo";
import { useMemo, useState } from "react";
import { RankingTrend } from "@/components/RankingTrend";
import { KeywordGraph } from "@/components/KeywordGraph";
import { PageHeader } from "@/components/PageHeader";
import { useDashboard } from "@/components/useDashboard";
import { DISPLAY_BUCKETS } from "@/lib/rank-display";
import { SerpOverview } from "@/components/SerpOverview";
import { groupKeywordDetails, keywordDetailCountryRanks } from "@/lib/keyword-details-group";
import type { DashboardKeyword } from "@/lib/types";

function KeywordNetwork({region}:{region:"all" | SearchRegionCode}) {
  const { data, loading, error, refresh } = useDashboard("all", "dataforseo_serp");
  const ready = Boolean(data);
  const keywords = useMemo(() => {
    const groups = groupKeywordDetails(data?.keywords ?? []);
    const ids = new Map(groups.flatMap(group => group.members.map(member => [member.id, group.id] as const)));
    return groups.map(group => ({ ...group.members[0], id: group.id, text: group.text,
      siteName: [...new Set(group.members.map(member => member.siteName ?? "Flatkey"))].join("、"),
      targetUrls: [...new Set(group.members.flatMap(member => member.targetUrls ?? []))],
      latestRanks: Object.fromEntries(keywordDetailCountryRanks(group, "all").map(value => [value.region, value.rank])) as DashboardKeyword["latestRanks"],
      monitoringEligible: group.members.some(member => member.monitoringEligible === true),
      parentIds: [...new Set(group.members.flatMap(member => (member.parentIds.length ? member.parentIds : member.parentId ? [member.parentId] : []).map(id => ids.get(id)).filter((id): id is string => Boolean(id))))],
      parentId: null,
    }));
  }, [data?.keywords]);
  const [graphSearch, setGraphSearch] = useState("");
  const graphKeywords = useMemo(() => {
    const query = graphSearch.trim().toLowerCase();
    return query ? keywords.filter((keyword) => `${keyword.text} ${keyword.topicText ?? ""} ${keyword.siteName ?? ""}`.toLowerCase().includes(query)) : keywords;
  }, [keywords, graphSearch]);
  return <section className="overviewGrid">{error ? <div className="loadError" role="alert"><span>{error}</span><button type="button" onClick={() => void refresh()}>重新加载</button></div> : null}
        <article className="graphPanel">
          <div className="panelHeader">
            <div>
              <h2>业务词库关系图</h2>
              <p>按{region === "all" ? "四国最佳" : REGIONS[region].label}排名着色，缩放或悬停查看关联</p>
            </div>
            <div className="graphTools"><label className="searchField graphSearch"><input aria-label="搜索图中关键词" placeholder="搜索图中关键词…" value={graphSearch} onChange={(event) => setGraphSearch(event.target.value)} /></label></div>
          </div>
          <p className="chartNote">{ready ? graphKeywords.length.toLocaleString() : "—"} 个{graphSearch ? "匹配" : "业务"}关键词 · 已去重</p>
          <div className="rankLegend">
            {DISPLAY_BUCKETS.map((bucket) => (
              <span key={bucket.key}>
                <i style={{ background: bucket.color }} />
                {bucket.key === "NOT_FOUND" ? "尚无实测排名记录" : bucket.range}
              </span>
            ))}
          </div>
          {loading ? (
            <div className="loadingState">正在加载关键词…</div>
          ) : error && !data ? (
            <div className="loadingState">词库读取失败，请点击上方「重新加载」</div>
          ) : (
            <KeywordGraph keywords={graphKeywords} region={region} />
          )}
        </article>
      </section>;
}

export function Dashboard() {
  const [region,setRegion] = useState<"all" | SearchRegionCode>("all");
  return (
    <main className="appShell">
      <PageHeader active="overview" />
      <div className="rankingPageToolbar"><h1>排名概览</h1><Select className="overviewCountrySelect" aria-label="概览国家筛选" value={region} onChange={setRegion} options={[{value:"all",label:"四国汇总"},...REGION_CODES.map(code=>({value:code,label:REGIONS[code].label}))]} /></div>
      <SerpOverview site="all" region={region} />
      <RankingTrend region={region} />

      <KeywordNetwork region={region} />
    </main>
  );
}
