"use client";

import { KeywordNetwork } from "./KeywordNetwork";
import { RankingTrend } from "./RankingTrend";
import { useSeoCountry } from "./useSeoCountry";
import styles from "./KeywordOpportunities.module.css";

export function SeoRankingsWorkspace({ view = "trend" }: { view?: "trend" | "network" }) {
  const [country] = useSeoCountry();
  return <section className={styles.rankingEvidence} aria-label={view === "trend" ? "选题排名趋势" : "选题词库关系"}>
    <p className={styles.note}>按实测采集期核对选题依据。尚未查询或查询失败的关键词保留为未知，不算掉榜。</p>
    {view === "trend" ? <RankingTrend region={country} /> : <KeywordNetwork region={country} />}
  </section>;
}
