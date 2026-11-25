import type { SeoTablePagination as Page } from "@/lib/seo-table-page";
import { FeedbackButton } from "./FeedbackButton";
import styles from "./SeoTablePagination.module.css";

export function SeoTablePagination({ pagination, onPage }: { pagination: Page; onPage: (page: number) => void }) {
  const { page, pageCount, total } = pagination;
  if (pageCount < 2) return null;
  return <nav className={styles.pagination} aria-label="列表分页">
    <span>共 {total} 条 · 第 {page} / {pageCount} 页</span>
    <FeedbackButton disabled={page === 1} onClick={() => onPage(page - 1)}>上一页</FeedbackButton>
    <FeedbackButton disabled={page === pageCount} onClick={() => onPage(page + 1)}>下一页</FeedbackButton>
  </nav>;
}
