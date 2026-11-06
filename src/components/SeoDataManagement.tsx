"use client";

import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "./PageHeader";
import { useSeoCountry } from "./useSeoCountry";
import { SeoAnalyticsStatus } from "./SeoAnalyticsStatus";
import { analyticsUrl, shanghaiStamp, useSeoRead, type SeoAnalytics } from "./useSeoAnalytics";
import { defaultRange } from "@/lib/seo-date-range";
import { clientReadCache } from "@/lib/client-read-cache";
import type { InventoryPage } from "@/lib/seo-page-inventory";
import shell from "./SeoWorkspace.module.css";
import styles from "./SeoDataManagement.module.css";

type Inventory = { source: string; capturedAt: string | null; pages: InventoryPage[] };

export function SeoDataManagement() {
  const [range] = useState(defaultRange);
  const [country] = useSeoCountry();
  const analytics = useSeoRead<SeoAnalytics>(analyticsUrl(range, [], country));
  const inventory = useSeoRead<Inventory>("/api/seo/pages");
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");
  const [syncError, setSyncError] = useState("");
  const refresh = () => { analytics.retry(); inventory.retry(); };
  const sync = async () => {
    setSyncing(true); setNotice(""); setSyncError("");
    try {
      const response = await fetch("/api/seo/pages", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "同步未完成，请重试");
      clientReadCache.clear(); inventory.retry();
      setNotice(`同步完成，台账共 ${result.pages.length.toLocaleString("zh-CN")} 个页面。`);
    } catch (error) { setSyncError(error instanceof Error ? error.message : "同步未完成，请重试"); }
    finally { setSyncing(false); }
  };
  const newPages = inventory.data?.pages.filter(page => !page.baseline).length ?? 0;
  return <main className={shell.shell}>
    <PageHeader active="manage" />
    <div className={shell.titleRow}><h1 className={shell.title}>数据管理</h1><button className={styles.button} type="button" onClick={refresh}>刷新状态</button></div>
    <section className={styles.section} aria-labelledby="source-heading">
      <h2 id="source-heading">每日数据</h2>
      <p className={styles.note}>近 30 个已结束日 · {range.start} 至 {range.end}</p>
      {analytics.data ? <div className={styles.sources}>
        <SeoAnalyticsStatus name="自然搜索访问与注册 · GA4" source={analytics.data.ga4} />
        <SeoAnalyticsStatus name="搜索表现 · GSC" source={analytics.data.gsc} />
      </div> : analytics.error ? <p role="alert">{analytics.error}</p> : <p className={styles.note}>正在读取数据状态…</p>}
      <Link className={styles.link} href={"/?" + new URLSearchParams({ ...range, country })}>查看流量趋势 →</Link>
      <details className={styles.details}><summary>查看采集说明</summary><p>每日数据由已有采集任务归档。这里显示已保存的数据状态，刷新仅重新读取记录。GA4 使用当次自然搜索渠道；GSC 可能比 GA4 晚更新，未采到的日期保留为空。</p><p>GA4 日期使用 America/Los_Angeles 时区；采集时间显示为北京时间。</p></details>
    </section>
    <section className={styles.section} aria-labelledby="sitemap-heading">
      <div className={styles.heading}><h2 id="sitemap-heading">页面自动发现</h2><button className={styles.button} type="button" disabled={syncing} onClick={() => void sync()}>{syncing ? "同步中…" : "同步 Sitemap"}</button></div>
      {inventory.data ? <>
        <p className={styles.count}>已登记 <strong>{inventory.data.pages.length.toLocaleString("zh-CN")}</strong> 个页面 · 基线之后新发现 <strong>{newPages.toLocaleString("zh-CN")}</strong> 个</p>
        <p className={styles.note}>{inventory.data.capturedAt ? `最近同步 ${shanghaiStamp(inventory.data.capturedAt)}（北京时间）` : "尚无同步记录"}</p>
      </> : inventory.error ? <p role="alert">{inventory.error}</p> : <p className={styles.note}>正在读取页面台账…</p>}
      <div className={styles.links}><Link className={styles.link} href={"/pages?" + new URLSearchParams({ ...range, category: "new", country })}>查看新发现页面 →</Link><a className={styles.link} href="https://flatkey.ai/sitemap.xml" target="_blank" rel="noreferrer">查看 Sitemap ↗</a></div>
      {notice ? <p role="status" className={styles.note}>{notice}</p> : null}
      {syncError ? <p role="alert">{syncError}</p> : null}
      <p className={styles.note}>同步会保留首次发现日期。首次发现不等于上线时间；暂时从 Sitemap 消失的页面仍保留在台账中。</p>
    </section>
    <footer className={styles.footer}><a href="https://flatkey-seo-roadmap.vercel.app/manage" target="_blank" rel="noreferrer">打开线上管理（关键词、采集计划与账号）↗</a></footer>
  </main>;
}
