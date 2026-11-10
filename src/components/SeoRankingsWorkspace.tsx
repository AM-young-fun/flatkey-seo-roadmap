"use client";

import Link from "next/link";
import { PageHeader } from "./PageHeader";
import { KeywordNetwork } from "./KeywordNetwork";
import { RankingTrend } from "./RankingTrend";
import { useSeoCountry } from "./useSeoCountry";
import styles from "./SeoWorkspace.module.css";

export function SeoRankingsWorkspace() {
  const [country] = useSeoCountry();
  const query = country === "all" ? "" : `?country=${country}`;
  return <main className={styles.shell}>
    <PageHeader active="rankings" />
    <div className={styles.titleRow}><h1 className={styles.title}>关键词排名分析</h1></div>
    <p className={styles.description}>按实测排名采集期查看趋势与关键词关系。尚未查询或查询失败的关键词保留为未知，不算掉榜。</p>
    <section className={styles.network} aria-label="关键词排名分析">
      <RankingTrend region={country} />
      <KeywordNetwork region={country} />
    </section>
    <nav className={styles.relatedLinks} aria-label="相关分析">
      <Link href={`/opportunities${query}`}>查看关键词机会 →</Link>
      <Link href={`/pages${query}`}>查看页面效果 →</Link>
      <Link href={`/${query}`}>返回总览</Link>
    </nav>
  </main>;
}
