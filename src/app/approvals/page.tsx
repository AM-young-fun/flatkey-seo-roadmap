import { Suspense } from "react";
import { SeoApprovalSkeleton, SeoApprovalWorkspace } from "@/components/SeoApprovalWorkspace";
import { SeoPageApprovals } from "@/components/SeoPageApprovals";

export const metadata = { title: "页面审批 · Flatkey SEO" };

export default function Page() {
  return <SeoApprovalWorkspace>
    <Suspense fallback={<SeoApprovalSkeleton />}><SeoPageApprovals /></Suspense>
  </SeoApprovalWorkspace>;
}
