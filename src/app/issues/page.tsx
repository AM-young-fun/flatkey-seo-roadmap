import { Suspense } from "react";
import { SeoWorkWorkspace } from "@/components/SeoWorkWorkspace";

export const metadata = { title: "问题台账 · Flatkey SEO" };

export default function Page() {
  return <Suspense fallback={<p role="status">正在读取问题台账…</p>}><SeoWorkWorkspace view="issues" /></Suspense>;
}
