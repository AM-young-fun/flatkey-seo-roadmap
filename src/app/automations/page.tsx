import { PageHeader } from "@/components/PageHeader";
import { SeoAutomationSchedule } from "@/components/SeoAutomationSchedule";
import styles from "@/components/SeoWorkspace.module.css";

export const metadata = { title: "定时任务 · Flatkey SEO" };

export default function Page() {
  return <main className={styles.shell}>
    <PageHeader active="automations" />
    <div className={styles.titleRow}><h1 className={styles.title}>定时任务</h1></div>
    <SeoAutomationSchedule />
  </main>;
}
