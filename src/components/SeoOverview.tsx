"use client";

import { useEffect, useState } from "react";
import type { GrowthReportSnapshot } from "@/lib/growth-strategy";
import type { GrowthWorkspace } from "@/lib/growth-types";
import { PageHeader } from "./PageHeader";
import { OverviewTrafficCharts, useOverviewTrafficReads } from "./OverviewTrafficCharts";
import { SeoDateControl, useSeoRange } from "./SeoDateControl";
import { RankingTrend } from "./RankingTrend";
import { GrowthRankingCoverage, GrowthTopicNetwork } from "./GrowthTopicWorkspace";
import { OverviewGrowthCharts, type OverviewConversion } from "./OverviewGrowthCharts";
import { useOverviewRead } from "./useSeoAnalytics";
import { useSeoCountry } from "./useSeoCountry";
import { REGIONS } from "@/lib/seo";
import { OVERVIEW_PAGE_MODULES, overviewModule, type OverviewPageModule } from "@/lib/seo-overview-scope";
import { UiSelect } from "./UiSelect";
import { PageLoading } from "./PageLoading";
import workspace from "./SeoWorkspace.module.css";
import styles from "./SeoOverview.module.css";

export function SeoOverview() {
  const context = useSeoRange("America/Los_Angeles");
  const [country] = useSeoCountry();
  const [module, setModule] = useState<OverviewPageModule>("all");
  const strategy = useOverviewRead<{ snapshot: GrowthReportSnapshot }>("/api/seo/growth/strategy?view=dashboard");
  const growth = useOverviewRead<GrowthWorkspace>("/api/seo/growth?view=dashboard", 90_000);
  const conversion = useOverviewRead<OverviewConversion>("/api/seo/growth/conversion");
  const traffic = useOverviewTrafficReads(context.range, context.comparison, module, country);
  const loading = [traffic.current, traffic.previous, traffic.landing]
    .some(read => read.loading && !read.retrying);
  useEffect(() => {
    const read = () => setModule(overviewModule(new URLSearchParams(location.search).get("module")));
    read(); addEventListener("popstate", read);
    return () => removeEventListener("popstate", read);
  }, []);
  const changeModule = (value: string) => {
    const next = overviewModule(value), params = new URLSearchParams(location.search);
    if (next === "all") params.delete("module"); else params.set("module", next);
    history.pushState(null, "", location.pathname + (params.size ? "?" + params : "") + location.hash);
    dispatchEvent(new PopStateEvent("popstate"));
  };
  const moduleLabel = OVERVIEW_PAGE_MODULES.find(([key]) => key === module)![1];
  return <main className={workspace.shell}>
    <PageHeader active="overview" />
    <div className={styles.content} aria-busy={loading} inert={loading}>
      <div className={styles.scopeHeading}><h1 className={styles.title}>自然搜索总览</h1>
        <UiSelect aria-label="总览页面模块" value={module} onChange={changeModule} options={OVERVIEW_PAGE_MODULES.map(([value, label]) => ({ value, label }))} />
      </div>
      <OverviewGrowthCharts strategy={strategy} growth={growth} conversion={conversion} />
      <GrowthRankingCoverage read={growth} />
      <div className={styles.trends}>
        <section className={styles.traffic} aria-labelledby="overview-traffic-title">
          <div className={styles.trafficHeading}>
            <div>
              <h2 id="overview-traffic-title">Flatkey {module === "all" ? "全站" : moduleLabel}自然搜索</h2>
              <p>{country === "all" ? "全部国家" : REGIONS[country].label}</p>
            </div>
            <SeoDateControl value={context} />
          </div>
          <OverviewTrafficCharts range={context.range} comparison={context.comparison} module={module} reads={traffic} />
        </section>
        <div className={styles.rankings}>
          <RankingTrend region={country} module={module} historicalScope chartsOnly />
        </div>
      </div>
      <div className={styles.network}>
        <GrowthTopicNetwork read={growth} />
      </div>
    </div>
    {loading && <PageLoading />}
  </main>;
}
