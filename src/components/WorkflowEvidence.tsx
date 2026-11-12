import { ExternalLink } from "lucide-react";
import type { WorkflowTask } from "@/lib/seo-workflow";
import { shanghaiStamp } from "./useSeoAnalytics";
import styles from "./SeoWorkWorkspace.module.css";

export function WorkflowEvidence({ evidence, heading }: { evidence: WorkflowTask["evidence"]; heading?: string }) {
  const links = evidence.flatMap(({ url, label, observedAt }) => {
    if (!url) return [];
    try {
      const target = new URL(url);
      if (target.protocol === "https:" && !target.username && !target.password) {
        return [{ href: target.href, label, observedAt }];
      }
    } catch {
      // Older records may have a local file reference in place of a web URL.
    }
    return [];
  });
  if (!links.length) return null;
  return <>
    {heading ? <h4>{heading}</h4> : null}
    <ul className={styles.evidence}>{links.map(({ href, label, observedAt }, index) => <li key={index}>
      <a href={href} target="_blank" rel="noreferrer">{label} <ExternalLink size={12} aria-hidden="true" /></a>
      <small>{shanghaiStamp(observedAt)}</small>
    </li>)}</ul>
  </>;
}
