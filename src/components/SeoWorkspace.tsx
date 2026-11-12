"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "./PageHeader";
import { UiSelect } from "./UiSelect";
import { SeoDateControl, useSeoRange } from "./SeoDateControl";
import { PageCatalog } from "./SeoPageCatalog";
import { SeoBusinessAnalytics } from "./SeoBusinessAnalytics";
import { SeoClusterReport } from "./SeoClusterReport";
import { SeoWorkWorkspace } from "./SeoWorkWorkspace";
import { PAGE_CATEGORIES } from "@/lib/seo-page-inventory";
import styles from "./SeoWorkspace.module.css";

const linkedCategories = [
  ["new", "新发现页面"], ["model_list", "模型列表"], ["model_detail", "模型详情"],
] as const;
const categories = [...PAGE_CATEGORIES, ...linkedCategories];

export function SeoWorkspace({ view = "pages" }: { view?: "pages" }) {
  const context = useSeoRange();
  const [category, setCategory] = useState("all");
  const [panel, setPanel] = useState("");
  useEffect(() => {
    const read = () => {
      const params = new URLSearchParams(location.search);
      const selected = params.get("category") ?? "all";
      setCategory(categories.some(([id]) => id === selected) ? selected : "all");
      setPanel(params.get("panel") ?? "");
    };
    read(); addEventListener("popstate", read);
    return () => removeEventListener("popstate", read);
  }, []);
  const filter = (key: string, value: string) => {
    const params = new URLSearchParams(location.search);
    if (value) params.set(key, value); else params.delete(key);
    history.pushState(null, "", location.pathname + (params.size ? "?" + params : ""));
    dispatchEvent(new PopStateEvent("popstate"));
  };
  return <main className={styles.shell}>
    <PageHeader active={view} />
    <div className={styles.titleRow}>
      <h1 className={styles.title}>页面优化</h1>
      <SeoDateControl value={context} />
    </div>
    <PageCatalog category={category} categoryLabel={categories.find(([id]) => id === category)?.[1] ?? "全部页面"} range={context.range} comparison={context.comparison} categoryControl={
      <UiSelect className={styles.category} aria-label="页面分类" value={category} onChange={value => filter("category", value)}
        options={[...PAGE_CATEGORIES, ...linkedCategories.filter(([id]) => id === category)].map(([value, label]) => ({ value, label }))} />
    } />
    <SeoBusinessAnalytics range={context.range} onCohortRangeSelect={range => context.update(range, null)} />
    <details className={styles.pageSupplement} open={panel === "optimizations"} onToggle={event => { const open = event.currentTarget.open; if (open !== (panel === "optimizations")) filter("panel", open ? "optimizations" : ""); }}>
      <summary>优化基线与复盘</summary>
      {panel === "optimizations" ? <SeoWorkWorkspace view="optimizations" embedded /> : null}
    </details>
    <details className={styles.pageSupplement} open={panel === "clusters"} onToggle={event => { const open = event.currentTarget.open; if (open !== (panel === "clusters")) filter("panel", open ? "clusters" : ""); }}>
      <summary>集群站点表现</summary>
      {panel === "clusters" ? <SeoClusterReport range={context.range} /> : null}
    </details>
  </main>;
}
