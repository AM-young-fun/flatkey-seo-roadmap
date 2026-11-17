import { PageHeader } from "@/components/PageHeader";
import { ReportLoading } from "@/components/ReportLoading";
import styles from "@/components/SeoWorkspace.module.css";

export default function Loading() {
  return <main className={styles.shell}>
    <PageHeader active="work" />
    <ReportLoading label="正在打开任务详情" />
  </main>;
}
