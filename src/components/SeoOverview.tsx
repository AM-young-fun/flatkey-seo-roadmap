"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { OverviewKeywordSummary, OverviewTrafficGoal } from "@/lib/overview-summary";
import { GROWTH_SITES } from "@/lib/growth-workspace";
import { PageHeader } from "./PageHeader";
import { useSeoRange } from "./SeoDateControl";
import { ChartPanel } from "./OverviewCharts";
import { OverviewKeywordProgress, OverviewGoalSection } from "./OverviewGrowthCharts";
import { useOverviewRead } from "./useSeoAnalytics";
import { TrafficRegistrationSummary, useTrafficSummaryTrend } from "./TrafficRegistrationSummary";
import { OverviewExecutionProgress } from "./OverviewExecutionProgress";
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
  const [coverageQuery, setCoverageQuery] = useState("");
  const goal = useOverviewRead<OverviewTrafficGoal>("/api/seo/growth/strategy?view=overview-goal");
  const growth = useOverviewRead<OverviewKeywordSummary>(keywordSummaryUrl);
  const scoped = useOverviewRead<OverviewKeywordSummary>(coverageQuery ? keywordSummaryUrl + "&" + coverageQuery : null);
  const traffic = useTrafficSummaryTrend(context);
  const trafficRange = traffic.data ?? traffic.previousData;
  useEffect(() => {
    const read = () => {
      const params = new URLSearchParams(location.search);
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
  return <main className={workspace.shell}>
    <PageHeader active="overview" />
    <div className={styles.content}>
      <h1 className={styles.title}>流量与 SEO 总览</h1>
      <OverviewGoalSection traffic={goal} growth={growth} />
      <TrafficRegistrationSummary dates={context} read={traffic} />
      {trafficRange ? <ClusterTrafficOverview range={trafficRange} /> : null}
      <OverviewKeywordProgress growth={growth} ranking={coverageQuery ? scoped : growth} />
      <OverviewTopicNetwork />
      <OverviewExecutionProgress />
    </div>
  </main>;
}
