"use client";

import { useEffect, useState } from "react";
import type { GrowthDashboardView } from "@/lib/growth-strategy";
import type { GrowthWorkspace } from "@/lib/growth-types";
import { PageHeader } from "./PageHeader";
import { useSeoRange } from "./SeoDateControl";
import { RankingTrend } from "./RankingTrend";
import { GrowthRankingCoverage, GrowthTopicNetwork } from "./GrowthTopicWorkspace";
import { OverviewContentSection, OverviewGoalSection } from "./OverviewGrowthCharts";
import { useOverviewRead } from "./useSeoAnalytics";
import { useSeoCountry } from "./useSeoCountry";
import { OVERVIEW_PAGE_MODULES, overviewModule, type OverviewPageModule } from "@/lib/seo-overview-scope";
import { UiSelect } from "./UiSelect";
import { PageLoading } from "./PageLoading";
import { TrafficRegistrationSummary, useTrafficSummaryTrend } from "./TrafficRegistrationSummary";
import { ClusterTrafficOverview } from "./ClusterTrafficOverview";
import workspace from "./SeoWorkspace.module.css";
import styles from "./SeoOverview.module.css";

export function SeoOverview() {
  const context = useSeoRange("America/Los_Angeles");
  const [country] = useSeoCountry();
  const [module, setModule] = useState<OverviewPageModule>("all");
  const strategy = useOverviewRead<GrowthDashboardView>("/api/seo/growth/strategy?view=dashboard");
  const growth = useOverviewRead<GrowthWorkspace>("/api/seo/growth?view=all-keyword-overview", 90_000);
  const traffic = useTrafficSummaryTrend(context);
  const trafficRange = traffic.data ?? traffic.previousData;
  const loading = !traffic.hasSettled && (!context.ready || traffic.loading);
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
  return <main className={workspace.shell}>
    <PageHeader active="overview" />
    <div className={styles.content} aria-busy={loading} inert={loading}>
      <div className={styles.scopeHeading}><h1 className={styles.title}>流量与 SEO 总览</h1>
        <UiSelect aria-label="排名页面模块" value={module} onChange={changeModule} options={OVERVIEW_PAGE_MODULES.map(([value, label]) => ({ value, label }))} />
      </div>
      <OverviewGoalSection strategy={strategy} growth={growth} />
      <TrafficRegistrationSummary dates={context} read={traffic} />
      {trafficRange ? <ClusterTrafficOverview range={trafficRange} /> : null}
      <OverviewContentSection growth={growth} />
      <GrowthRankingCoverage read={growth} />
      <div className={styles.rankings}>
        <RankingTrend region={country} module={module} historicalScope chartsOnly />
      </div>
      <div className={styles.network}>
        <GrowthTopicNetwork read={growth} />
      </div>
    </div>
    {loading && <PageLoading />}
  </main>;
}
