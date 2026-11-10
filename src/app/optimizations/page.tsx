import { Suspense } from "react";
import { SeoWorkWorkspace } from "@/components/SeoWorkWorkspace";

export const metadata = { title: "页面优化 · Flatkey SEO" };

export default function Page() {
  return <Suspense fallback={<p role="status">正在读取优化记录…</p>}><SeoWorkWorkspace view="optimizations" /></Suspense>;
}
