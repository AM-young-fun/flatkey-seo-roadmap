import { Suspense } from "react";
import { SeoWorkWorkspace } from "@/components/SeoWorkWorkspace";

export const metadata = { title: "发布记录 · Flatkey SEO" };

export default function Page() {
  return <Suspense fallback={<p role="status">正在读取发布记录…</p>}><SeoWorkWorkspace view="deliveries" /></Suspense>;
}
