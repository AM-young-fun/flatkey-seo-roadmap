import Link from "./AppLink";
import { SeoAnchor } from "./SeoAnchor";
import { keywordCategories, type KeywordCategory, type KeywordTopic, type NumericSort } from "@/lib/growth-keyword-lookup";
import styles from "./GrowthTopicWorkspace.module.css";

export function KeywordTopics({ topics }: { topics: readonly KeywordTopic[] }) {
  if (!topics.length) return <>—</>;
  return <>{topics.map(({ topicId, site, name }) => <div key={site + ":" + topicId} className={styles.capturePage}>
    <Link href={`/topics/${encodeURIComponent(topicId)}?${new URLSearchParams({ site })}`}>{name}</Link>
    {topics.length > 1 ? <small>{site}</small> : null}
  </div>)}</>;
}

export function KeywordCategories({ categories }: { categories: readonly KeywordCategory[] }) {
  return <>{categories.map(key => keywordCategories[key]).join("、") || "—"}</>;
}

export function KeywordPages({ urls }: { urls: readonly string[] }) {
  if (!urls.length) return <>—</>;
  return <>{urls.map(url => <div key={url} className={styles.capturePage}>
    <SeoAnchor href={url} target="_blank" rel="noreferrer">{url}</SeoAnchor>
  </div>)}</>;
}

export function KeywordNumericHeader({ label, order, onChange }: { label: string; order: NumericSort | null; onChange: (order: NumericSort) => void }) {
  const next = order === "asc" ? "desc" : "asc";
  return <th scope="col" aria-sort={order === "asc" ? "ascending" : order === "desc" ? "descending" : "none"}>
    <button type="button" className={styles.numericHeader} aria-label={`按${label}${next === "asc" ? "升序" : "降序"}排列`} onClick={() => onChange(next)}>
      {label} <span aria-hidden="true">{order === "asc" ? "↑" : order === "desc" ? "↓" : "↕"}</span>
    </button>
  </th>;
}
