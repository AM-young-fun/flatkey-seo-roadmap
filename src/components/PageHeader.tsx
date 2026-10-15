"use client";
import { RegionSelect } from "@/components/RegionSelect";
import { type SeoSelection } from "@/components/useSeoSelection";
import Link from "next/link";
import { ChartNoAxesCombined, List, Settings2, LogOut, Target } from "lucide-react";
import { dashboardStore } from "@/lib/dashboard-client";

export function PageHeader({
  active, selection,
}: {
  active: "overview" | "keywords" | "manage" | "traffic" | "okr";
  selection?: SeoSelection;
}) {
  return (
    <header className="siteHeader">
      <Link href="/" className="brand">
        <span className="brandIcon">
          <ChartNoAxesCombined size={20} />
        </span>
        Flatkey<span className="brandSub">SEO 洞察</span>
      </Link>
      {selection && active !== "traffic" ? <div className="headerFilters">
        <RegionSelect value={selection.region} onChange={selection.setRegion} />
      </div> : null}
      <nav aria-label="主导航">
        <Link href="/okr" className={active === "okr" ? "navLink active" : "navLink"} aria-current={active === "okr" ? "page" : undefined}>
          <Target size={16} />
          SEO 目标
        </Link>
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
        <form action="/api/auth/logout" method="post" onSubmit={() => dashboardStore.clear()}>
          <button className="iconButton" title="退出登录" aria-label="退出登录">
            <LogOut size={16} />
          </button>
        </form>
      </nav>
    </header>
  );
}
