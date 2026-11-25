import styles from "./ReportLoading.module.css";
import { PageLoading } from "./PageLoading";

export function ReportLoading({ label, compact = false }: { label: string; compact?: boolean }) {
  return compact ? <p className={styles.note} aria-busy="true">{label}…</p> : <PageLoading label={label} />;
}
