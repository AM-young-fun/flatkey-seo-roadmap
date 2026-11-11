"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { KeywordEvidenceView } from "@/lib/keyword-workspace-routes";
import { REGION_CODES, type SearchRegionCode } from "@/lib/seo";
import styles from "./KeywordOpportunities.module.css";

const KeywordDetails = dynamic(() => import("./KeywordDetails").then(module => module.KeywordDetails), { loading: () => <p role="status">正在读取关键词明细…</p> });
const RankingEvidence = dynamic(() => import("./SeoRankingsWorkspace").then(module => module.SeoRankingsWorkspace), { loading: () => <p role="status">正在读取排名依据…</p> });
const views = [{ value: "keywords", label: "关键词明细与筛选" }, { value: "rankings", label: "排名趋势" }, { value: "network", label: "词库关系" }] as const;

export function KeywordResearchEvidence() {
  const [params, setParams] = useState("");
  useEffect(() => {
    const read = () => setParams(location.search);
    read(); addEventListener("popstate", read);
    return () => removeEventListener("popstate", read);
  }, []);
  const query = new URLSearchParams(params), value = query.get("details");
  const active = views.some(view => view.value === value) ? value as KeywordEvidenceView : null;
  const initialCountry = query.get("country"), country = REGION_CODES.includes(initialCountry as SearchRegionCode) ? initialCountry as SearchRegionCode : "all";
  function toggle(view: KeywordEvidenceView) {
    const next = new URLSearchParams(location.search);
    if (active === view) next.delete("details"); else next.set("details", view);
    history.pushState(null, "", `${location.pathname}${next.size ? `?${next}` : ""}#keyword-evidence`);
    dispatchEvent(new PopStateEvent("popstate"));
  }
  return <section id="keyword-evidence" className={styles.evidence} aria-label="选题依据与关键词操作">
    <div className={styles.evidenceActions}>{views.map(view => <button key={view.value} type="button" aria-expanded={active === view.value} aria-controls="keyword-evidence-content" onClick={() => toggle(view.value)}>{view.label}<span aria-hidden="true">{active === view.value ? " −" : " +"}</span></button>)}</div>
    {active ? <div id="keyword-evidence-content" className={styles.evidenceContent}>
      {active === "keywords" ? <KeywordDetails key={`${country}:${query.get("status")}:${query.get("keyword")}:${query.get("q")}:${query.get("business")}:${query.get("crossLanguage")}`} embedded
        initiallyOptimized={query.get("status") === "optimized"} initialCountry={country}
        initialSearch={query.get("q") ?? query.get("keyword") ?? ""} initialBusiness={query.get("business") === "CLOUD_GPU" ? "CLOUD_GPU" : "FLATKEY_API"} initialCrossLanguage={query.get("crossLanguage") === "1"} />
        : <RankingEvidence view={active === "network" ? "network" : "trend"} />}
    </div> : null}
  </section>;
}
