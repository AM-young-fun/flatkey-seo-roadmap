import styles from "./ReportLoading.module.css";
import { LoaderCircle } from "lucide-react";

export function ReportLoading({ label, compact = false }: { label: string; compact?: boolean }) {
  return <div className={compact ? styles.compact : styles.panel} role="status" aria-label={label}>
    <div className={styles.label}><LoaderCircle size={16} className="feedback-spinner" aria-hidden="true" />{label}</div>
    <div className={styles.lines} aria-hidden="true"><span /><span /><span /></div>
  </div>;
}
