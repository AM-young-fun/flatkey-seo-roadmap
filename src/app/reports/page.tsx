import { Suspense } from "react";
import { PageHeader } from "@/components/PageHeader";
import { SeoDigestReports } from "@/components/SeoDigestReports";
import workspace from "@/components/SeoWorkspace.module.css";

export const metadata = { title: "日／周效果总结 · Flatkey SEO" };

export default function Page() {
  return <main className={workspace.shell}>
    <Suspense fallback={<p role="status">正在读取日／周效果总结…</p>}>
      <PageHeader active="reports" />
      <SeoDigestReports />
    </Suspense>
  </main>;
}
