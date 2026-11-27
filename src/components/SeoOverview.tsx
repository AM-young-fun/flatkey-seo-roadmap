"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { OverviewKeywordSummary, OverviewTrafficGoal } from "@/lib/overview-summary";
import { GROWTH_SITES } from "@/lib/growth-workspace";
import { PageHeader } from "./PageHeader";
import { useSeoRange } from "./SeoDateControl";
import { RankingTrend } from "./RankingTrend";
import { ChartPanel } from "./OverviewCharts";
import { GrowthRankingCoverage, OverviewContentSection, OverviewGoalSection } from "./OverviewGrowthCharts";
import { useOverviewRead } from "./useSeoAnalytics";
import { useSeoCountry } from "./useSeoCountry";
import { OVERVIEW_PAGE_MODULES, overviewModule, type OverviewPageModule } from "@/lib/seo-overview-scope";
import { UiSelect } from "./UiSelect";
import { TrafficRegistrationSummary, useTrafficSummaryTrend } from "./TrafficRegistrationSummary";
import { ClusterTrafficOverview } from "./ClusterTrafficOverview";
import workspace from "./SeoWorkspace.module.css";
import styles from "./SeoOverview.module.css";

const keywordSummaryUrl = "/api/seo/growth?view=overview-summary";
const GrowthTopicNetwork = dynamic(() => import("./GrowthTopicWorkspace").then(module => module.GrowthTopicNetwork), {
  ssr: false,
  loading: () => <ChartPanel title="话题关系图"><p role="status">正在打开关系图…</p></ChartPanel>,
});

function OverviewTopicNetwork() {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (visible || !container.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setVisible(true);
    }, { rootMargin: "120px" });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [visible]);
  return <div ref={container} className={styles.network}>
    {visible ? <GrowthTopicNetwork /> : <ChartPanel title="话题关系图"><button type="button" onClick={() => setVisible(true)}>加载关系图</button></ChartPanel>}
  </div>;
}

export function SeoOverview() {
  const context = useSeoRange("America/Los_Angeles");
  const [country] = useSeoCountry();
  const [module, setModule] = useState<OverviewPageModule>("all");
  const [coverageQuery, setCoverageQuery] = useState("");
  const goal = useOverviewRead<OverviewTrafficGoal>("/api/seo/growth/strategy?view=overview-goal");
  const growth = useOverviewRead<OverviewKeywordSummary>(keywordSummaryUrl);
  const scoped = useOverviewRead<OverviewKeywordSummary>(coverageQuery ? keywordSummaryUrl + "&" + coverageQuery : null);
  const traffic = useTrafficSummaryTrend(context);
  const trafficRange = traffic.data ?? traffic.previousData;
  useEffect(() => {
    const read = () => {
      const params = new URLSearchParams(location.search);
      setModule(overviewModule(params.get("module")));
      const coverage = new URLSearchParams();
      const site = params.get("site");
      if (site && GROWTH_SITES.some(value => value.domain === site)) coverage.set("site", site);
      for (const key of ["country", "language"]) {
        const value = params.get(key);
        if (value && value.toLowerCase() !== "all") coverage.set(key, value);
      }
      setCoverageQuery(coverage.toString());
    };
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
    <div className={styles.content}>
      <div className={styles.scopeHeading}><h1 className={styles.title}>流量与 SEO 总览</h1>
        <UiSelect aria-label="排名页面模块" value={module} onChange={changeModule} options={OVERVIEW_PAGE_MODULES.map(([value, label]) => ({ value, label }))} />
      </div>
      <OverviewGoalSection traffic={goal} growth={growth} />
      <TrafficRegistrationSummary dates={context} read={traffic} />
      {trafficRange ? <ClusterTrafficOverview range={trafficRange} /> : null}
      <OverviewContentSection growth={growth} />
      <GrowthRankingCoverage read={coverageQuery ? scoped : growth} />
      <div className={styles.rankings}>
        <RankingTrend region={country} module={module} historicalScope chartsOnly />
      </div>
      <OverviewTopicNetwork />
    </div>
  </main>;
}
