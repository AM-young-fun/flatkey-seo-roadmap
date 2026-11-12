import Link from "next/link";
import styles from "./SeoWorkWorkspace.module.css";

export function WorkTabs({ active }: { active: "tasks" | "traffic" | "approvals" }) {
  return <nav className={styles.workTabs} aria-label="工作任务页面">
    <Link href="/work" aria-current={active === "tasks" ? "page" : undefined}>任务列表</Link>
    <Link href="/work?panel=published-traffic" aria-current={active === "traffic" ? "page" : undefined}>上线效果</Link>
    <Link href="/work?panel=approvals" aria-current={active === "approvals" ? "page" : undefined}>最终审批</Link>
  </nav>;
}
