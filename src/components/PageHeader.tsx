"use client";

import Link from "@/components/AppLink";
import { useEffect, useState } from "react";
import { ChartNoAxesCombined, CircleCheck, Clock3, KeyRound, LayoutDashboard, ListTodo, LogOut, Search, TrendingUp } from "lucide-react";
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
  ["opportunities", "/opportunities", "关键词目标", Search],
  ["reports", "/reports", "日周效果", ChartNoAxesCombined],
  ["optimization-effects", "/optimization-effects", "优化效果", TrendingUp],
  ["automations", "/automations", "定时任务", Clock3],
] as const;
export function PageHeader({ active, marketControl = true }: {
  active: "loading" | "overview" | "keywords" | "manage" | "traffic" | "pages" | "records" | "clusters" | "work" | "approvals" | "opportunities" | "rankings" | "deliveries" | "optimizations" | "issues" | "runs" | "credentials" | "automations" | "reports" | "optimization-effects";
  marketControl?: boolean;
}) {
  const preview = usePreviewMode();
  const [country, setCountry] = useSeoCountry();
  const [query, setQuery] = useState("");
  const activeWork = ["traffic", "records", "deliveries", "runs", "manage", "pages", "clusters", "optimizations", "issues", "approvals"].includes(active) ? "work"
    : ["keywords", "rankings"].includes(active) ? "opportunities"
    : active;
  useEffect(() => {
    const read = () => {
      const current = new URLSearchParams(location.search), next = new URLSearchParams();
      for (const key of ["start", "end", "compareStart", "compareEnd", "compare", "country", "site", "business", "language", "week", "module"]) {
        const value = current.get(key); if (value) next.set(key, value);
      }
      setQuery(next.size ? "?" + next.toString() : "");
    };
    read(); addEventListener("popstate", read);
    return () => removeEventListener("popstate", read);
  }, [active]);

  return <>
    <header data-seo-workspace className={styles.header}>
      <Link href={"/" + query} className={styles.brand} aria-label="Flatkey SEO 总览"><span className={styles.brandIcon}><ChartNoAxesCombined size={19} strokeWidth={2.2} aria-hidden="true" /></span><span className={styles.brandName}>Flatkey <b>SEO</b></span></Link>
      <nav className={styles.nav} aria-label="主导航">
        {workspaceLinks.map(([key, path, label, Icon]) => <Link key={key} href={path + query} className={styles.navLink} aria-current={activeWork === key ? "page" : undefined}><Icon size={17} aria-hidden="true" /><span>{label}</span></Link>)}
        <div role="group" aria-label="工具与设置">
          <Link href="/credentials" className={styles.navLink} aria-current={active === "credentials" ? "page" : undefined}><KeyRound size={17} aria-hidden="true" /><span>接入凭证</span></Link>
        </div>
      </nav>
      <div className={styles.utilities}>
        {marketControl && !["approvals", "issues", "credentials", "automations"].includes(activeWork) ? <div className={styles.countryControl}><span className={styles.controlLabel}>市场</span><UiSelect className={styles.countrySelect} aria-label="国家" value={country} onChange={setCountry}
          options={[{ value: "all", label: "全部国家" }, ...REGION_CODES.map(value => ({ value, label: REGIONS[value].label }))]} /></div> : null}
        {preview ? <span className={styles.preview}><CircleCheck size={12} aria-hidden="true" />本地预览</span> : null}
      </div>
      {!preview ? <form className={styles.logout} action="/api/auth/logout" method="post" onSubmit={() => { dashboardStore.clear(); clientReadCache.clear(); }}>
        <button className={styles.navLink} type="submit"><LogOut size={17} aria-hidden="true" /><span>退出登录</span></button>
      </form> : null}
    </header>
  </>;
}
