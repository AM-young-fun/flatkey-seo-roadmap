import { LoaderCircle } from "lucide-react";
import styles from "./PageLoading.module.css";

export function PageLoading({ label = "正在加载页面数据…", shared = false }: { label?: string; shared?: boolean }) {
  return <div className={styles.cover} data-page-loading={shared ? "shared" : "local"}>
    <div className={styles.status} role="status">
      <LoaderCircle size={27} className="feedback-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  </div>;
}
