"use client";
import { useState } from "react";
import { Table, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { RegionSelect } from "@/components/RegionSelect";
import { useDashboard } from "@/components/useDashboard";
import type { DashboardKeyword } from "@/lib/types";
import { REGION_CODES, REGIONS, type SearchRegionCode } from "@/lib/seo";
import {
  displayBucket,
  displayRank,
  rankDescription,
} from "@/lib/rank-display";

export function KeywordDetails() {
  const { data, error, loading, refresh } = useDashboard();
  const [region, setRegion] = useState<SearchRegionCode>("US");
  const [search, setSearch] = useState("");
  const rows = (data?.keywords ?? []).filter((keyword) =>
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
    {
      title: "更新时间",
      dataIndex: "lastSyncedAt",
      key: "updated",
      width: 155,
      sorter: (a, b) =>
        Date.parse(a.lastSyncedAt ?? "") - Date.parse(b.lastSyncedAt ?? ""),
      render: (value: string | null) =>
        value
          ? new Date(value).toLocaleString("zh-CN", {
              timeZone: "Asia/Shanghai",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "—",
    },
    ...REGION_CODES.map((market) => ({
      title: REGIONS[market].label,
      key: market,
      width: 135,
      sorter: (a: DashboardKeyword, b: DashboardKeyword) =>
        (a.latestRanks[market]?.rank ?? Infinity) -
        (b.latestRanks[market]?.rank ?? Infinity),
      render: (_: unknown, keyword: DashboardKeyword) => {
        const rank = keyword.latestRanks[market];
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
    })),
  ];
  return (
    <main className="appShell">
      <PageHeader active="keywords" />
      <div className="pageIntro">
        <p className="eyebrow">KEYWORD DIRECTORY</p>
        <h1>关键词明细</h1>
        <p>
          {data?.targetDomain ?? "—"} · 共 {data?.keywords.length ?? 0} 个关键词
          · 每天 10:30（北京时间）更新
        </p>
      </div>
      {error ? (
        <div className="loadError" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void refresh()}>
            重新加载
          </button>
        </div>
      ) : null}
      <div className="detailToolbar">
        <RegionSelect value={region} onChange={setRegion} />
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
