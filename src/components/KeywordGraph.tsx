"use client";
import type * as echarts from "echarts";
import { useEffect, useMemo, useRef } from "react";
import type { DashboardKeyword } from "@/lib/types";
import { REGIONS, type SearchRegionCode } from "@/lib/seo";
import {
  displayBucket,
  displayRank,
  rankDescription,
} from "@/lib/rank-display";

export function KeywordGraph({
  keywords,
  selectedRegion,
}: {
  keywords: DashboardKeyword[];
  selectedRegion: SearchRegionCode;
}) {
  const element = useRef<HTMLDivElement>(null);
  const option = useMemo<echarts.EChartsOption>(() => {
    const ids = new Set(keywords.map((keyword) => keyword.id));
    const groups = new Map<string, DashboardKeyword[]>();
    keywords.forEach((keyword) => {
      const groupId = keyword.topicId ?? keyword.id;
      const members = groups.get(groupId) ?? [];
      members.push(keyword); groups.set(groupId, members);
    });
    const groupList = [...groups.entries()].sort((a,b) => a[0].localeCompare(b[0]));
    const positions = new Map<string, {x:number;y:number}>();
    // A golden-angle disk keeps every keyword visible in one circular footprint
    // without running a force simulation on the full inventory.
    groupList.flatMap(([, members]) => members).forEach((keyword, index) => {
      const angle = index * Math.PI * (3 - Math.sqrt(5));
      const radius = 500 * Math.sqrt((index + 0.5) / keywords.length);
      positions.set(keyword.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    });
    const large = keywords.length > 300;
    const edges = new Map<string, { source: string; target: string }>();
    const addEdge = (source: string, target: string) => {
      if (source !== target && ids.has(source) && ids.has(target))
        edges.set([source, target].sort().join(":"), { source, target });
    };
    keywords.forEach((keyword) =>
      (keyword.parentIds.length
        ? keyword.parentIds
        : keyword.parentId
          ? [keyword.parentId]
          : []
      ).forEach((parent) => addEdge(parent, keyword.id)),
    );
    groups.forEach((members) => {
      const sorted = [...members].sort(
        (a, b) => b.volume - a.volume || a.id.localeCompare(b.id),
      );
      sorted.slice(1).forEach((member) => addEdge(sorted[0].id, member.id));
    });
    const nodes = keywords.map((keyword) => {
      const knownVolume = keyword.marketVolumes[selectedRegion];
      const volume = knownVolume ?? 0;
      const dotSize = Math.max(3, Math.min(18, 560 / Math.sqrt(keywords.length)));
      return {
        id: keyword.id,
        name: keyword.text,
        keyword,
        volume: knownVolume,
        x: positions.get(keyword.id)!.x,
        y: positions.get(keyword.id)!.y,
        symbolSize: dotSize * (0.75 + Math.min(0.6, Math.log10(volume + 1) * 0.1)),
        itemStyle: {
          color: displayBucket(keyword.latestRanks[selectedRegion]?.rank).color,
          borderColor: "#fff",
          borderWidth: large ? 0.5 : 2,
          shadowBlur: large ? 0 : 8,
          shadowColor: "rgba(15,23,42,0.08)",
        },
      };
    });
    return {
      animation: !large,
      animationDurationUpdate: 400,
      tooltip: {
        renderMode: "richText",
        confine: true,
        formatter: (params: unknown) => {
          const node = (
            params as { data?: { keyword?: DashboardKeyword; volume?: number } }
          ).data;
          if (!node?.keyword) return "同话题或父子关键词关联";
          const keyword = node.keyword;
          return `${keyword.text}\n所属网站：${keyword.siteName ?? "Flatkey"}\n所属话题：${keyword.topicText ?? "—"}\n${REGIONS[selectedRegion].label}排名：${displayRank(keyword.latestRanks[selectedRegion])}\n${rankDescription(keyword.latestRanks[selectedRegion])}\n声量：${node.volume?.toLocaleString() ?? "—"}`;
        },
      },
      series: [
        {
          type: "graph",
          layout: "none",
          left: "6%", top: "6%", width: "88%", height: "88%",
          roam: true,
          draggable: true,
          data: nodes,
          links: [...edges.values()],
          label: {
            show: !large,
            position: "right",
            color: "#475569",
            fontSize: 11,
            width: 150,
            overflow: "truncate",
          },
          labelLayout: { hideOverlap: true },
          lineStyle: { color: "#cbd5e1", opacity: large ? 0.04 : 0.3, curveness: 0.08 },
          scaleLimit: { min: 0.2, max: large ? 20 : 4 },
          emphasis: { focus: "adjacency", label: { show: true }, lineStyle: { width: 2 } },
        },
      ],
    };
  }, [keywords, selectedRegion]);
  useEffect(() => {
    if (!element.current || !keywords.length) return;
    const target = element.current;
    let disposed = false;
    let chart: echarts.ECharts | undefined;
    let observer: ResizeObserver | undefined;
    void import("@/lib/charts").then(({ init }) => {
      if (disposed) return;
      chart = init(target);
      chart.setOption(option, true);
      observer = new ResizeObserver(() => chart?.resize());
      observer.observe(target);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      chart?.dispose();
    };
  }, [keywords.length, option]);
  return keywords.length ? (
    <div
      ref={element}
      className="keywordGraph"
      role="img"
      aria-label={`${REGIONS[selectedRegion].label}关键词关系图，按排名着色；完整数据可在关键词明细中查看`}
    />
  ) : (
    <div className="emptyGraph">暂无关键词，请通过顶部「数据管理」导入</div>
  );
}
