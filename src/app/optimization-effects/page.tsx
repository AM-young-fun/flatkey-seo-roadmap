import { Suspense } from "react";
import { OptimizationEffects } from "@/components/OptimizationEffects";
import { PageHeader } from "@/components/PageHeader";
import workspace from "@/components/SeoWorkspace.module.css";

export const metadata = { title: "优化效果 · Flatkey SEO" };

export default function Page() {
  return <main className={workspace.shell}>
    <Suspense fallback={<p role="status">正在读取优化效果…</p>}>
      <PageHeader active="optimization-effects" />
      <div className={workspace.pageSection}><OptimizationEffects /></div>
    </Suspense>
  </main>;
}
