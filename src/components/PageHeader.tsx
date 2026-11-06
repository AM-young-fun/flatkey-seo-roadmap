"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { usePreviewMode } from "./PreviewMode";
import { CollectionProgress } from "./CollectionProgress";
import { dashboardStore } from "@/lib/dashboard-client";
import { clientReadCache } from "@/lib/client-read-cache";
import styles from "./PageHeader.module.css";
import { UiSelect } from "./UiSelect";
import { useSeoCountry } from "./useSeoCountry";
import { REGIONS, REGION_CODES } from "@/lib/seo";

const GA4_REALTIME_URL = "https://analytics.google.com/analytics/web/#/a248149353p541304395/realtime/overview";

export function PageHeader({ active }: {
  active: "overview" | "keywords" | "manage" | "traffic" | "pages" | "records" | "clusters";
}) {
  const preview = usePreviewMode();
  const [country, setCountry] = useSeoCountry();
  const countryQuery = country === "all" ? "" : "?country=" + country;
  const [query, setQuery] = useState("");
  const tools = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const read = () => {
      const current = new URLSearchParams(location.search), next = new URLSearchParams();
      for (const key of ["start", "end", "compareStart", "compareEnd", "compare", "country"]) {
        const value = current.get(key); if (value) next.set(key, value);
      }
      setQuery(next.size ? "?" + next.toString() : "");
    };
    read(); addEventListener("popstate", read);
    const close = (event: PointerEvent) => {
      if (tools.current && !tools.current.contains(event.target as Node)) tools.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && tools.current?.open) {
        tools.current.open = false;
        tools.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", escape);
    return () => {
      removeEventListener("popstate", read);
      document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape);
    };
  }, []);

  return <>
    {active === "manage" && !preview ? <CollectionProgress /> : null}
    <header className={`${styles.header} ${styles.headerWithControl}`}>
      <Link href={"/" + query} className={styles.brand} aria-label="Flatkey SEO 总览">Flatkey <span>SEO</span></Link>
      <nav className={styles.nav} aria-label="主导航">
        <Link href={"/" + query} className={styles.navLink} aria-current={active === "overview" || active === "records" ? "page" : undefined}>总览</Link>
        <Link href={"/pages" + query} className={styles.navLink} aria-current={active === "pages" ? "page" : undefined}>页面效果</Link>
        <Link href={"/opportunities" + query} className={styles.navLink} aria-current={active === "keywords" ? "page" : undefined}>关键词机会</Link>
        <Link href={"/traffic" + countryQuery} className={styles.navLink} aria-current={active === "traffic" ? "page" : undefined}>日/周总结</Link>
        <Link href={"/clusters" + query} className={styles.navLink} aria-current={active === "clusters" ? "page" : undefined}>集群网站</Link>
      </nav>
      <div className={styles.utilities}>
        <UiSelect className={styles.countrySelect} aria-label="国家" value={country} onChange={setCountry}
          options={[{ value: "all", label: "全部国家" }, ...REGION_CODES.map(value => ({ value, label: REGIONS[value].label }))]} />
        {preview ? <span className={styles.preview}>本地预览</span> : null}
        <details ref={tools} className={styles.tools}>
          <summary className={styles.toolsButton}>工具 <ChevronDown size={14} aria-hidden="true" /></summary>
          <div className={styles.menu}>
            <Link href={"/manage" + countryQuery} aria-current={active === "manage" ? "page" : undefined}>数据管理</Link>
            <a href={GA4_REALTIME_URL} target="_blank" rel="noreferrer">GA4 全渠道实时报告 <ExternalLink size={13} aria-hidden="true" /></a>
            {!preview ? <form action="/api/auth/logout" method="post" onSubmit={() => { dashboardStore.clear(); clientReadCache.clear(); }}><button type="submit">退出登录</button></form> : null}
          </div>
        </details>
      </div>
    </header>
  </>;
}
