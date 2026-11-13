import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./SeoWorkWorkspace.module.css";
import { PageHeader } from "./PageHeader";
import workspace from "./SeoWorkspace.module.css";
import review from "./SeoPageApprovals.module.css";

export function SeoApprovalWorkspace({ children }: { children: ReactNode }) {
  return <main className={workspace.shell}>
    <PageHeader active="work" />
    <div className={workspace.titleRow}><Link href="/work" className={styles.secondary}>← 返回工作任务</Link></div>
    <div className={review.approvalBody}>
      <div className={review.approvalHeading}><h1 className={workspace.title}>页面审批</h1></div>
      {children}
    </div>
  </main>;
}

export function SeoApprovalSkeleton() {
  return <div className={review.approvalLoading} role="status" aria-label="正在读取页面审批">
    <div className={styles.summary} aria-hidden="true">
      {[0, 1, 2].map(index => <div key={index}><span className={review.skeletonLabel} /><span className={review.skeletonNumber} /></div>)}
    </div>
    <div className={styles.listPanel} aria-hidden="true">
      <span className={review.skeletonLabel} />
      <div className={review.skeletonFilters}><span /><span /><span /></div>
      {[0, 1, 2].map(index => <div className={review.skeletonRecord} key={index}>
        <div><span className={review.skeletonLabel} /><span className={review.skeletonMeta} /></div><span className={review.skeletonMeta} />
      </div>)}
    </div>
  </div>;
}
