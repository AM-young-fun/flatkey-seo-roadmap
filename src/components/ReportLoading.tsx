import styles from "./ReportLoading.module.css";

export function ReportLoading({ label, compact = false }: { label: string; compact?: boolean }) {
  return <div className={compact ? styles.compact : styles.panel} role="status" aria-label={label}>
    <span aria-hidden="true" />
    <span aria-hidden="true" />
    <span aria-hidden="true" />
  </div>;
}
