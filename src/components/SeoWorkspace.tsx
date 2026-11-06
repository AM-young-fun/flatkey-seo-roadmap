"use client";
import { UiSelect } from "./UiSelect";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "./PageHeader";
import { SeoDateControl, useSeoRange } from "./SeoDateControl";
import { SeoPeriodSummary } from "./SeoPeriodSummary";
import { DailySeoTrafficTrend } from "./DailySeoTrafficTrend";
import { DailySeoPageGroups } from "./DailySeoPageGroups";
import { KeywordNetwork } from "./KeywordNetwork";
import { RankingTrend } from "./RankingTrend";
import { PageCatalog } from "./SeoPageCatalog";
import { SeoHistoryDisclosure } from "./SeoHistoryDisclosure";
import { SessionSeoReport } from "./SessionSeoReport";
import { useSeoCountry } from "./useSeoCountry";
import { PAGE_CATEGORIES } from "@/lib/seo-page-inventory";
import styles from "./SeoWorkspace.module.css";

const linkedCategories = [
  ["new", "新发现页面"], ["model_list", "模型列表"], ["model_detail", "模型详情"],
] as const;
const categories = [...PAGE_CATEGORIES, ...linkedCategories];

export function SeoWorkspace({ view = "overview" }: { view?: "overview" | "pages" | "records" }) {
  const context = useSeoRange();
  const { range, comparison } = context;
  const [category, setCategory] = useState("all");
  const [region] = useSeoCountry();
  useEffect(() => {
    const read = () => {
      const params = new URLSearchParams(location.search);
      const selected = params.get("category") ?? "all";
      setCategory(categories.some(([id]) => id === selected) ? selected : "all");
    };
    read(); addEventListener("popstate", read);
    return () => removeEventListener("popstate", read);
  }, []);
  const filter = (key: string, value: string) => {
    const params = new URLSearchParams(location.search);
    params.set(key, value);
    history.pushState(null, "", location.pathname + "?" + params);
    dispatchEvent(new PopStateEvent("popstate"));
  };
  const title = { overview: "自然搜索总览", pages: "页面效果", records: "每日记录" }[view];
  const rangeKey = range.start + range.end;
  const href = (path: string) => path + "?" + new URLSearchParams({
    ...range,
    ...(region === "all" ? {} : { country: region }),
    ...(comparison ? { compareStart: comparison.start, compareEnd: comparison.end } : { compare: "none" }),
  });
  return <main className={styles.shell}>
    <PageHeader active={view} />
    <div className={styles.titleRow}>
      <h1 className={styles.title}>{title}</h1>
      <SeoDateControl value={context} />
    </div>
    {view === "pages" ? <PageCatalog category={category} categoryLabel={categories.find(([id]) => id === category)?.[1] ?? "全部页面"} range={range} comparison={comparison} categoryControl={
      <UiSelect className={styles.category} aria-label="页面分类" value={category} onChange={value => filter("category", value)}
        options={[...PAGE_CATEGORIES, ...linkedCategories.filter(([id]) => id === category)].map(([value, label]) => ({ value, label }))} />
    } /> : <SessionSeoReport range={range} comparison={comparison} expanded={view === "records"} showDetails={view !== "overview"} footer={view === "records" ? <Link href={href("/")}>返回总览</Link> : null}>
      {view === "records" && region === "all" ? <SeoHistoryDisclosure>
        <SeoPeriodSummary range={range} comparison={comparison} />
        <DailySeoTrafficTrend key={rangeKey} {...range} expanded={view === "records"} />
        <DailySeoPageGroups key={rangeKey} {...range} category="all" />
      </SeoHistoryDisclosure> : null}
    </SessionSeoReport>}
    {view === "overview" ? <section id="business-network" className={styles.network} aria-label="业务词库关系图">
      <RankingTrend region={region} />
      <KeywordNetwork region={region} />
    </section> : null}
  </main>;
}
