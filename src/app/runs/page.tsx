import { Suspense } from "react";
import { SeoWorkWorkspace } from "@/components/SeoWorkWorkspace";

export const metadata = { title: "运行日志 · Flatkey SEO" };

export default function Page() {
  return <Suspense fallback={<p role="status">正在读取运行日志…</p>}><SeoWorkWorkspace view="runs" /></Suspense>;
}
