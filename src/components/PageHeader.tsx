"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { usePreviewMode } from "./PreviewMode";
import { dashboardStore } from "@/lib/dashboard-client";
import { clientReadCache } from "@/lib/client-read-cache";
import styles from "./PageHeader.module.css";
import { UiSelect } from "./UiSelect";
import { useSeoCountry } from "./useSeoCountry";
import { REGIONS, REGION_CODES } from "@/lib/seo";

const analysisLinks = [
  ["traffic", "/traffic", "流量分析", "自然访问、注册与日期明细"],
  ["pages", "/pages", "页面效果", "逐页点击、曝光与搜索词"],
  ["opportunities", "/opportunities", "关键词机会", "筛选下一批内容选题"],
  ["rankings", "/rankings", "排名分析", "实测排名趋势与词库分布"],
  ["keywords", "/keywords", "关键词明细", "各国排名、目标页和证据"],
  ["clusters", "/clusters", "集群效果", "四个集群站的搜索表现"],
] as const;
const executionLinks = [
  ["work", "/work", "执行计划", "本周、下周任务和关键词"],
  ["deliveries", "/deliveries", "发布验收", "正式交付与历史记录"],
  ["optimizations", "/optimizations", "优化记录", "改前基线、版本和后续效果"],
  ["issues", "/issues", "问题台账", "缺失、异常与处理进度"],
  ["runs", "/runs", "定时任务", "任务安排与真实运行结果"],
] as const;
const GA4_REALTIME_URL = "https://analytics.google.com/analytics/web/#/a248149353p541304395/realtime/overview";

export function PageHeader({ active }: {
  active: "overview" | "keywords" | "manage" | "traffic" | "pages" | "records" | "clusters" | "work" | "approvals" | "opportunities" | "rankings" | "deliveries" | "optimizations" | "issues" | "runs";
}) {
  const preview = usePreviewMode();
  const [country, setCountry] = useSeoCountry();
  const [query, setQuery] = useState("");
  const header = useRef<HTMLElement>(null);
  useEffect(() => {
    const read = () => {
      const current = new URLSearchParams(location.search), next = new URLSearchParams();
      for (const key of ["start", "end", "compareStart", "compareEnd", "compare", "country", "site", "business", "language", "week"]) {
        const value = current.get(key); if (value) next.set(key, value);
      }
      setQuery(next.size ? "?" + next.toString() : "");
    };
    read(); addEventListener("popstate", read);
    const close = (event: PointerEvent) => {
      header.current?.querySelectorAll("details").forEach(menu => { if (!menu.contains(event.target as Node)) menu.open = false; });
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") header.current?.querySelectorAll("details[open]").forEach(menu => { (menu as HTMLDetailsElement).open = false; menu.querySelector("summary")?.focus(); });
    };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", escape);
    return () => {
      removeEventListener("popstate", read);
      document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape);
    };
  }, [active]);

  return <>
    <header ref={header} className={`${styles.header} ${styles.headerWithControl}`}>
      <Link href={"/" + query} className={styles.brand} aria-label="Flatkey SEO 总览">Flatkey <span>SEO</span></Link>
      <nav className={styles.nav} aria-label="主导航">
        <Link href={"/" + query} className={styles.navLink} aria-current={active === "overview" ? "page" : undefined}>总览</Link>
        {([["效果分析", analysisLinks], ["内容执行", executionLinks]] as const).map(([label, links]) => <details key={label} className={styles.navGroup}>
          <summary className={styles.groupButton} aria-current={links.some(([key]) => key === active) ? "true" : undefined}>{label}<ChevronDown size={13} aria-hidden="true" /></summary>
          <div className={`${styles.menu} ${styles.groupMenu}`}>{links.map(([key, path, title, detail]) => <Link key={key} href={path + query} aria-current={active === key ? "page" : undefined}><span><strong>{title}</strong><small>{detail}</small></span></Link>)}</div>
        </details>)}
        <Link href="/approvals" className={styles.navLink} aria-current={active === "approvals" ? "page" : undefined}>页面审批</Link>
      </nav>
      <div className={styles.utilities}>
        {!["approvals", "issues", "runs"].includes(active) ? <UiSelect className={styles.countrySelect} aria-label="国家" value={country} onChange={setCountry}
          options={[{ value: "all", label: "全部国家" }, ...REGION_CODES.map(value => ({ value, label: REGIONS[value].label }))]} /> : null}
        {preview ? <span className={styles.preview}>本地预览</span> : null}
        <details className={styles.tools}>
          <summary className={styles.toolsButton}>工具 <ChevronDown size={14} aria-hidden="true" /></summary>
          <div className={styles.menu}>
            <a href={GA4_REALTIME_URL} target="_blank" rel="noreferrer">GA4 全渠道实时报告 <ExternalLink size={13} aria-hidden="true" /></a>
            {!preview ? <form action="/api/auth/logout" method="post" onSubmit={() => { dashboardStore.clear(); clientReadCache.clear(); }}><button type="submit">退出登录</button></form> : null}
          </div>
        </details>
      </div>
    </header>
  </>;
}
