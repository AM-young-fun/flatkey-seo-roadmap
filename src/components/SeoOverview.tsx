"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "./PageHeader";
import { SessionSeoReport } from "./SessionSeoReport";
import { SeoDateControl, useSeoRange } from "./SeoDateControl";
import { RankingTrend } from "./RankingTrend";
import { KeywordNetwork } from "./KeywordNetwork";
import { useSeoCountry } from "./useSeoCountry";
import { REGIONS } from "@/lib/seo";
import { OVERVIEW_PAGE_MODULES, overviewModule, type OverviewPageModule } from "@/lib/seo-overview-scope";
import { UiSelect } from "./UiSelect";
import { ModuleSeoReport } from "./ModuleSeoReport";
import workspace from "./SeoWorkspace.module.css";
import styles from "./SeoOverview.module.css";

export function SeoOverview() {
  const context = useSeoRange();
  const [country] = useSeoCountry();
  const [module, setModule] = useState<OverviewPageModule>("all");
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
    <div className={styles.content}>
      <div className={styles.scopeHeading}><h1 className={styles.title}>自然搜索总览</h1>
        <UiSelect aria-label="总览页面模块" value={module} onChange={changeModule} options={OVERVIEW_PAGE_MODULES.map(([value, label]) => ({ value, label }))} />
      </div>
      <div className={styles.trends}>
        <section className={styles.traffic} aria-labelledby="overview-traffic-title">
          <div className={styles.trafficHeading}>
            <div>
              <h2 id="overview-traffic-title">Flatkey {module === "all" ? "全站" : moduleLabel}自然搜索</h2>
              <p>{country === "all" ? "全部国家" : REGIONS[country].label}</p>
            </div>
            <SeoDateControl value={context} />
          </div>
          {module === "all" ? <SessionSeoReport range={context.range} comparison={context.comparison} compact showSourceSummary showDetails={false} />
            : <ModuleSeoReport range={context.range} comparison={context.comparison} module={module} country={country} showDetails={false} />}
        </section>
        <div className={styles.rankings}>
          <RankingTrend region={country} module={module} />
        </div>
      </div>
      <div className={styles.network}>
        <KeywordNetwork region={country} module={module} />
      </div>
    </div>
  </main>;
}
