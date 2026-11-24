import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./ReviewedReportBody.module.css";
import { SeoAnchor } from "@/components/SeoAnchor";


function reportUrl(url: string) {
  const safe = defaultUrlTransform(url);
  if (!safe) return undefined;
  if (safe.startsWith("#") || safe.startsWith("?") || /^\/(?![\\/])/.test(safe)) return safe;
  try { return new URL(safe).protocol === "https:" ? safe : undefined; }
  catch { return undefined; }
}

const components: Components = {
  p({ children, node }) {
    const first = node?.children[0];
    const heading = first?.type === "element" && first.tagName === "strong"
      ? first.children.map(child => child.type === "text" ? child.value : "").join("") : "";
    // The approved template uses bold standalone lines for its six section titles.
    return node?.children.length === 1 && /^[一二三四五六七八九十]+、/.test(heading)
      ? <h3>{children}</h3> : <p>{children}</p>;
  },
  a({ children, href }) {
    if (!href) return <span>{children}</span>;
    return <SeoAnchor href={href} target={/^https:/i.test(href) ? "_blank" : undefined} rel="noopener noreferrer">{children}</SeoAnchor>;
  },
  table({ children }) {
    return <div className={styles.tableScroll} role="region" aria-label="周报数据表，可横向滚动" tabIndex={0}>
      <table>{children}</table>
    </div>;
  },
  th({ children, style, align }) {
    return <th style={style} align={align} scope="col">{children}</th>;
  },
  // Reports link to evidence; they do not load remote images or tracking pixels.
  img({ alt }) { return alt ? <span>{alt}</span> : null; },
};

export function ReviewedReportBody({ text, label = "已审周报完整正文" }: { text: string; label?: string }) {
  return <section className={styles.body} aria-label={label}>
    <Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={reportUrl} components={components}>{text}</Markdown>
  </section>;
}
