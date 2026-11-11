"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ChartNoAxesCombined, CheckSquare2, Clock3, ChevronDown, CircleCheck, ExternalLink, FileSearch, KeyRound, LayoutDashboard, ListTodo, Search, Settings2, TriangleAlert } from "lucide-react";
import { usePreviewMode } from "./PreviewMode";
import { dashboardStore } from "@/lib/dashboard-client";
import { clientReadCache } from "@/lib/client-read-cache";
import styles from "./PageHeader.module.css";
import { UiSelect } from "./UiSelect";
import { useSeoCountry } from "./useSeoCountry";
import { REGIONS, REGION_CODES } from "@/lib/seo";

const workspaceLinks = [
  ["overview", "/", "总览", LayoutDashboard],
  ["work", "/work", "工作任务", ListTodo],
  ["opportunities", "/opportunities", "关键词选题", Search],
  ["pages", "/pages", "页面优化", FileSearch],
  ["approvals", "/approvals", "页面审批", CheckSquare2],
  ["issues", "/issues", "问题处理", TriangleAlert],
  ["automations", "/automations", "定时任务", Clock3],
] as const;
const GA4_REALTIME_URL = "https://analytics.google.com/analytics/web/#/a248149353p541304395/realtime/overview";

export function PageHeader({ active }: {
  active: "overview" | "keywords" | "manage" | "traffic" | "pages" | "records" | "clusters" | "work" | "approvals" | "opportunities" | "rankings" | "deliveries" | "optimizations" | "issues" | "runs" | "credentials" | "automations";
}) {
  const preview = usePreviewMode();
  const [country, setCountry] = useSeoCountry();
  const [query, setQuery] = useState("");
  const header = useRef<HTMLElement>(null);
  const activeWork = ["traffic", "records", "deliveries", "runs", "manage"].includes(active) ? "work"
    : ["keywords", "rankings"].includes(active) ? "opportunities"
    : ["clusters", "optimizations"].includes(active) ? "pages" : active;
  useEffect(() => {
    const read = () => {
      const current = new URLSearchParams(location.search), next = new URLSearchParams();
      for (const key of ["start", "end", "compareStart", "compareEnd", "compare", "country", "site", "business", "language", "week", "module"]) {
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
    <header ref={header} data-seo-workspace className={styles.header}>
      <Link href={"/" + query} className={styles.brand} aria-label="Flatkey SEO 总览"><span className={styles.brandIcon}><ChartNoAxesCombined size={19} strokeWidth={2.2} aria-hidden="true" /></span><span className={styles.brandName}>Flatkey <b>SEO</b></span></Link>
      <nav className={styles.nav} aria-label="主导航">
        {workspaceLinks.map(([key, path, label, Icon]) => <Link key={key} href={path + query} className={styles.navLink} aria-current={activeWork === key ? "page" : undefined}><Icon size={17} aria-hidden="true" /><span>{label}</span></Link>)}
      </nav>
      <div className={styles.utilities}>
        {!["approvals", "issues", "credentials", "automations"].includes(activeWork) ? <div className={styles.countryControl}><span className={styles.controlLabel}>市场</span><UiSelect className={styles.countrySelect} aria-label="国家" value={country} onChange={setCountry}
          options={[{ value: "all", label: "全部国家" }, ...REGION_CODES.map(value => ({ value, label: REGIONS[value].label }))]} /></div> : null}
        <details className={styles.tools}>
          <summary className={styles.toolsButton} aria-label="工具与设置"><Settings2 size={16} aria-hidden="true" /><span>工具与设置</span><ChevronDown size={13} aria-hidden="true" /></summary>
          <div className={styles.menu}>
            <Link href="/credentials" aria-current={active === "credentials" ? "page" : undefined}>接入凭据 <KeyRound size={13} aria-hidden="true" /></Link>
            <a href={GA4_REALTIME_URL} target="_blank" rel="noreferrer">GA4 全渠道实时报告 <ExternalLink size={13} aria-hidden="true" /></a>
            {!preview ? <form action="/api/auth/logout" method="post" onSubmit={() => { dashboardStore.clear(); clientReadCache.clear(); }}><button type="submit">退出登录</button></form> : null}
          </div>
        </details>
        <a className={styles.foundation} href="https://alidocs.dingtalk.com/i/nodes/jb9Y4gmKWrQa6B4mHrdNPxke8GXn6lpz" target="_blank" rel="noreferrer">数据基础 <ArrowUpRight size={13} aria-hidden="true" /></a>
        {preview ? <span className={styles.preview}><CircleCheck size={12} aria-hidden="true" />本地预览</span> : null}
      </div>
    </header>
  </>;
}
