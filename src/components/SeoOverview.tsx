"use client";

import Link from "next/link";
import { PageHeader } from "./PageHeader";
import { SessionSeoReport } from "./SessionSeoReport";
import { SeoDateControl, useSeoRange } from "./SeoDateControl";
import { RankingTrend } from "./RankingTrend";
import { KeywordNetwork } from "./KeywordNetwork";
import { BusinessMeasurementStatus } from "./BusinessMeasurementStatus";
import { useSeoCountry } from "./useSeoCountry";
import { REGIONS } from "@/lib/seo";
import workspace from "./SeoWorkspace.module.css";
import styles from "./SeoOverview.module.css";

export function SeoOverview() {
  const context = useSeoRange();
  const [country] = useSeoCountry();
  const countryQuery = country === "all" ? "" : `?country=${country}`;
  return <main className={workspace.shell}>
    <PageHeader active="overview" />
    <div className={styles.content}>
      <h1 className={styles.title}>自然搜索总览</h1>
      <div className={styles.trends}>
        <section className={styles.traffic} aria-labelledby="overview-traffic-title">
          <div className={styles.trafficHeading}>
            <div>
              <h2 id="overview-traffic-title">Flatkey 全站自然搜索</h2>
              <p>{country === "all" ? "全部国家" : REGIONS[country].label}</p>
            </div>
            <SeoDateControl value={context} />
          </div>
          <SessionSeoReport range={context.range} comparison={context.comparison} compact showSourceSummary detailsLabel="数据口径与日期明细" />
        </section>
        <div className={styles.rankings}>
          <RankingTrend region={country} />
        </div>
      </div>
      <div className={styles.network}>
        <KeywordNetwork region={country} showModuleFilter />
      </div>
      <nav className={styles.relatedLinks} aria-label="总览后续操作">
        <Link href={"/opportunities" + countryQuery}>选择关键词</Link>
        <Link href={"/pages" + countryQuery}>查看页面效果与优化</Link>
        <Link href="/approvals">查看待审批页面</Link>
      </nav>
      <BusinessMeasurementStatus compact />
    </div>
  </main>;
}
