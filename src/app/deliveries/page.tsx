import { Suspense } from "react";
import { SeoWorkWorkspace } from "@/components/SeoWorkWorkspace";

export const metadata = { title: "发布验收 · Flatkey SEO" };

export default function Page() {
  return <Suspense fallback={<p role="status">正在读取发布验收…</p>}><SeoWorkWorkspace view="deliveries" /></Suspense>;
}
