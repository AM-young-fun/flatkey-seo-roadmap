"use client";
import { useState } from "react";
import { Table, Tooltip, Select } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useSeoSelection } from "@/components/useSeoSelection";
import { useDashboard } from "@/components/useDashboard";
import type { DashboardKeyword } from "@/lib/types";
import { REGIONS } from "@/lib/seo";
import {
  displayBucket,
  displayRank,
  rankDescription,
  matchesRanking,
} from "@/lib/rank-display";

const ORIGINS = [
  { value: "ALL", label: "全部关键词", description: "展示各类关键词；词库来源与是否有排名分别记录。" },
  { value: "PLANNED", label: "页面目标词", description: "已选定用于页面或内容的主词、辅助词；页面可能已发布，也可能待发布。" },
  { value: "CLUSTER", label: "集群页面词", description: "来自模型、GPU、地区、服务商等集群页面的关键词。" },
  { value: "DISCOVERED", label: "实际搜索词", description: "从 GSC 或 Ahrefs 搜索报告中发现，可能尚未纳入内容选题。" },
  { value: "RESEARCH", label: "待评估词", description: "来自原始关键词研究词库；导入时尚未确认页面是否覆盖，供选题评估。" },
];

export function KeywordDetails() {
  const selection = useSeoSelection();
  const { region } = selection;
  const { data, error, loading, refreshing, refresh } = useDashboard(selection.site, selection.source);
  const [search, setSearch] = useState("");
  const [origin, setOrigin] = useState("ALL");
  const [rankScope, setRankScope] = useState("ALL");
  const rows = (data?.keywords ?? []).filter((keyword) => origin === "ALL" || keyword.origin === origin).filter((keyword) => matchesRanking(keyword.latestRanks[region], rankScope)).filter((keyword) =>
    `${keyword.text} ${keyword.topicText ?? ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const columns: ColumnsType<DashboardKeyword> = [
    {
      title: "关键词",
      dataIndex: "text",
      key: "keyword",
      width: 230,
      sorter: (a, b) => a.text.localeCompare(b.text),
      render: (text: string) => <strong>{text}</strong>,
    },
    { title: "所属网站", key: "site", width: 115, render: (_, keyword) => <span className="muted">{keyword.siteName ?? "Flatkey"}</span> },
    { title: "词库来源", key: "origin", width: 115, render: (_, keyword) => {
      const source = ORIGINS.find((entry) => entry.value === (keyword.origin ?? "PLANNED"));
      return <Tooltip title={source?.description}><span className="muted">{source?.label ?? "—"}</span></Tooltip>;
    } },
    {
      title: "所属话题",
      dataIndex: "topicText",
      key: "topic",
      width: 230,
      render: (text: string | null) => (
        <span className="muted">{text ?? "—"}</span>
      ),
    },
    {
      title: `声量 · ${REGIONS[region].label}`,
      key: "volume",
      width: 130,
      defaultSortOrder: "descend",
      sorter: (a, b) =>
        (a.marketVolumes[region] ?? -1) - (b.marketVolumes[region] ?? -1),
      render: (_, keyword) =>
        keyword.marketVolumes[region]?.toLocaleString() ?? "—",
    },
    { title: "排名页面", key: "url", width: 250, render: (_, keyword) => {
      const url = keyword.latestRanks[region]?.url;
      return url ? <a className="observedUrl" href={url} target="_blank" rel="noreferrer">{url.replace(/^https?:\/\//, "")}</a> : <span className="muted">尚未采集页面</span>;
    } },
    { title: "目标页面", key: "targets", width: 220, render: (_, keyword) => <span className="muted">{keyword.targetUrls?.length ? keyword.targetUrls.map((url) => <a className="observedUrl" href={url} target="_blank" rel="noreferrer" key={url}>{url.replace(/^https?:\/\//, "")}</a>) : "尚未关联页面"}</span> },
    {
      title: "更新时间",
      key: "updated",
      width: 155,
      sorter: (a, b) =>
        Date.parse(a.latestRanks[region]?.checkedAt ?? "") - Date.parse(b.latestRanks[region]?.checkedAt ?? ""),
      render: (_, keyword) => {
        const value = keyword.latestRanks[region]?.checkedAt;
        return (
        value
          ? new Date(value).toLocaleString("zh-CN", {
              timeZone: "Asia/Shanghai",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "—");
      },
    },
    {
      title: `排名 · ${REGIONS[region].label}`,
      key: "rank",
      width: 135,
      sorter: (a: DashboardKeyword, b: DashboardKeyword) =>
        (a.latestRanks[region]?.rank ?? Infinity) -
        (b.latestRanks[region]?.rank ?? Infinity),
      render: (_: unknown, keyword: DashboardKeyword) => {
        const rank = keyword.latestRanks[region];
        return (
          <Tooltip
            title={`${rankDescription(rank)}${rank?.checkedAt ? ` · 采集于 ${new Date(rank.checkedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}` : ""}`}
          >
            <span
              className="detailRank"
              style={{ color: displayBucket(rank?.rank).color }}
            >
              <i />
              {displayRank(rank)}
              {rank?.source === "gsc" ? (
                <small>GSC 均值</small>
              ) : rank?.source === "ahrefs" ? (
                <small>Ahrefs</small>
              ) : null}
            </span>
          </Tooltip>
        );
      },
    },
  ];
  return (
    <main className="appShell">
      <PageHeader active="keywords" selection={selection} />
      <div className="pageIntro">
        <p className="eyebrow">KEYWORD DIRECTORY</p>
        <h1>关键词明细</h1>
        <p>
          全部网站 · {data ? `共 ${data.keywords.length} 条关键词与网站记录` : "正在加载关键词…"}
          · 每天 10:30（北京时间）更新
        </p>
      </div>
      {refreshing ? <p className="cacheNotice" role="status">已显示上次加载的词库结果，正在获取最新数据…</p> : null}
      {error ? (
        <div className="loadError" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void refresh()}>
            重新加载
          </button>
        </div>
      ) : null}
      <div className="detailToolbar">
        <div className="detailFilters">
          <label className="originSelectField"><span>词库来源</span><Select aria-label="词库来源" className="originSelect" value={origin} onChange={setOrigin} popupMatchSelectWidth={350} virtual={false} options={ORIGINS} optionRender={(option) => <div className="originOption"><strong>{option.data.label}</strong><small>{option.data.description}</small></div>} /></label>
          <label className="originSelectField"><span>排名 · {REGIONS[region].label}</span><Select aria-label="关键词排名筛选" className="originSelect" value={rankScope} onChange={setRankScope} options={[{value:"ALL",label:"全部排名"},{value:"TOP100",label:"已有前 100 排名"},{value:"TOP10",label:"前 10 名"},{value:"11_30",label:"11–30 名"},{value:"31_50",label:"31–50 名"},{value:"51_100",label:"51–100 名"},{value:"OUTSIDE",label:"确认前 100 外"},{value:"UNKNOWN",label:"未采集 / 暂无数据"}]} /></label>
        </div>
        <label className="searchField">
          <Search size={17} />
          <input
            aria-label="搜索关键词或话题"
            placeholder="搜索关键词或话题…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      <p className="chartNote sourceExplanation">{ORIGINS.find((entry) => entry.value === origin)?.description} · 当前筛选 {rows.length} 条记录；排名筛选以{REGIONS[region].label}为准。</p>
      <section className="tablePanel">
        <Table
          className="keywordTable"
          columns={columns}
          dataSource={rows}
          rowKey="id"
          loading={loading}
          pagination={{
            defaultPageSize: 50,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 个关键词`,
          }}
          scroll={{ x: 1250 }}
          size="middle"
        />
      </section>
      <p className="chartNote detailNote">
        声量随所选地区切换。GSC
        显示统计区间内的平均排名；「暂无数据」不代表确认没有排名。鼠标悬停可查看来源和日期。
      </p>
    </main>
  );
}
