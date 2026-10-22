"use client";
import { useState } from "react";
import { Select } from "antd";
import { REGIONS, REGION_CODES, type SearchRegionCode } from "@/lib/seo";
import { RankingTrend } from "@/components/RankingTrend";
import { PageHeader } from "@/components/PageHeader";
import { SerpOverview } from "@/components/SerpOverview";
import { KeywordDemand } from "@/components/KeywordDemand";

export function Dashboard() {
  const [region,setRegion] = useState<"all" | SearchRegionCode>("all");
  return (
    <main className="appShell">
      <PageHeader active="overview" />
      <div className="rankingPageToolbar"><h1>排名概览</h1><Select className="overviewCountrySelect" aria-label="概览国家筛选" value={region} onChange={setRegion} options={[{value:"all",label:"四国汇总"},...REGION_CODES.map(code=>({value:code,label:REGIONS[code].label}))]} /></div>
      <SerpOverview site="all" region={region} />
      <RankingTrend region={region} />

      <KeywordDemand key={region} initialRegion={region === "all" ? "US" : region} />
    </main>
  );
}
