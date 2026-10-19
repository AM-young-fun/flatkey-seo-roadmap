"use client";
import Link from "next/link";
import { ChartNoAxesCombined, List, Settings2, LogOut } from "lucide-react";
import { dashboardStore } from "@/lib/dashboard-client";
import { clientReadCache } from "@/lib/client-read-cache";

export function PageHeader({
  active,
}: {
  active: "overview" | "keywords" | "manage" | "traffic";
}) {
  return (
    <header className="siteHeader">
      <Link href="/" className="brand">
        <span className="brandIcon">
          <ChartNoAxesCombined size={20} />
        </span>
        Flatkey<span className="brandSub">SEO 洞察</span>
      </Link>
      <nav aria-label="主导航">
        <Link
          href="/"
          className={active === "overview" ? "navLink active" : "navLink"}
          aria-current={active === "overview" ? "page" : undefined}
        >
          <ChartNoAxesCombined size={16} />
          排名概览
        </Link>
        <Link
          href="/keywords"
          className={active === "keywords" ? "navLink active" : "navLink"}
          aria-current={active === "keywords" ? "page" : undefined}
        >
          <List size={16} />
          关键词明细
        </Link>
        <Link href="/traffic" className={active === "traffic" ? "navLink active" : "navLink"} aria-current={active === "traffic" ? "page" : undefined}>流量周报</Link>
        <Link
          href="/manage"
          className={active === "manage" ? "navLink active" : "navLink"}
          aria-current={active === "manage" ? "page" : undefined}
        >
          <Settings2 size={16} />
          数据管理
        </Link>
        <form action="/api/auth/logout" method="post" onSubmit={() => { dashboardStore.clear(); clientReadCache.clear(); }}>
          <button className="iconButton" title="退出登录" aria-label="退出登录">
            <LogOut size={16} />
          </button>
        </form>
      </nav>
    </header>
  );
}
