"use client";
import { RegionSelect } from "@/components/RegionSelect";
import { SITES, type SeoSelection } from "@/components/useSeoSelection";
import Link from "next/link";
import { ChartNoAxesCombined, List, Settings2, LogOut } from "lucide-react";

export function PageHeader({
  active, selection,
}: {
  active: "overview" | "keywords" | "manage" | "pages" | "traffic";
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
      {selection ? <div className="headerFilters">
        <label><span className="srOnly">选择网站</span><select aria-label="选择网站" value={selection.site} onChange={(e) => selection.setSite(e.target.value)}>{SITES.map((site) => <option key={site.domain} value={site.domain}>{site.name}</option>)}</select></label>
        <label><span className="srOnly">排名来源</span><select aria-label="排名来源" value={selection.source} onChange={(e) => selection.setSource(e.target.value)}><option value="ahrefs">Ahrefs</option><option value="gsc">GSC 均值</option></select></label>
        <RegionSelect value={selection.region} onChange={selection.setRegion} />
      </div> : null}
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
        <Link href="/pages" className={active === "pages" ? "navLink active" : "navLink"} aria-current={active === "pages" ? "page" : undefined}>排名页面</Link>
        <Link href="/traffic" className={active === "traffic" ? "navLink active" : "navLink"} aria-current={active === "traffic" ? "page" : undefined}>流量周报</Link>
        <Link
          href="/manage"
          className={active === "manage" ? "navLink active" : "navLink"}
          aria-current={active === "manage" ? "page" : undefined}
        >
          <Settings2 size={16} />
          数据管理
        </Link>
        <form action="/api/auth/logout" method="post">
          <button className="iconButton" title="退出登录" aria-label="退出登录">
            <LogOut size={16} />
          </button>
        </form>
      </nav>
    </header>
  );
}
