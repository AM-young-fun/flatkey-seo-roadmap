import { Suspense } from "react";
import { SeoApprovalWorkspace } from "@/components/SeoApprovalWorkspace";

export const metadata = { title: "页面审批 · Flatkey SEO" };

export default function Page() {
  return <Suspense fallback={<p role="status">正在读取页面审批…</p>}><SeoApprovalWorkspace /></Suspense>;
}
