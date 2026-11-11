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

const workspaceLinks = [
  ["work", "/work", "工作任务"],
  ["opportunities", "/opportunities", "关键词选题"],
  ["pages", "/pages", "页面优化"],
  ["approvals", "/approvals", "页面审批"],
  ["issues", "/issues", "问题处理"],
] as const;
const GA4_REALTIME_URL = "https://analytics.google.com/analytics/web/#/a248149353p541304395/realtime/overview";

export function PageHeader({ active }: {
  active: "overview" | "keywords" | "manage" | "traffic" | "pages" | "records" | "clusters" | "work" | "approvals" | "opportunities" | "rankings" | "deliveries" | "optimizations" | "issues" | "runs";
}) {
  const preview = usePreviewMode();
  const [country, setCountry] = useSeoCountry();
  const [query, setQuery] = useState("");
  const header = useRef<HTMLElement>(null);
  const activeWork = ["overview", "traffic", "records", "deliveries", "runs", "manage"].includes(active) ? "work"
    : ["keywords", "rankings"].includes(active) ? "opportunities"
    : ["clusters", "optimizations"].includes(active) ? "pages" : active;
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
      <Link href={"/work" + query} className={styles.brand} aria-label="Flatkey SEO 工作任务">Flatkey <span>SEO</span></Link>
      <nav className={styles.nav} aria-label="主导航">
        {workspaceLinks.map(([key, path, label]) => <Link key={key} href={path + query} className={styles.navLink} aria-current={activeWork === key ? "page" : undefined}>{label}</Link>)}
      </nav>
      <div className={styles.utilities}>
        {!["approvals", "issues"].includes(activeWork) ? <UiSelect className={styles.countrySelect} aria-label="国家" value={country} onChange={setCountry}
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
