"use client";
import * as echarts from "echarts";
import { useEffect, useMemo, useRef } from "react";
import type { DashboardKeyword } from "@/lib/types";
import { hashString, REGIONS, type SearchRegionCode } from "@/lib/seo";
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
  const instance = useRef<echarts.ECharts | null>(null);
  const option = useMemo<echarts.EChartsOption>(() => {
    const ids = new Set(keywords.map((keyword) => keyword.id));
    const groups = new Map<string, DashboardKeyword[]>();
    keywords.forEach((keyword) => {
      if (keyword.topicId)
        groups.set(keyword.topicId, [
          ...(groups.get(keyword.topicId) ?? []),
          keyword,
        ]);
    });
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
      const volume = keyword.marketVolumes[selectedRegion] ?? 0;
      const angle =
        ((hashString(keyword.topicId ?? keyword.id) % 360) / 180) * Math.PI;
      const offset = hashString(keyword.id) % 120;
      return {
        id: keyword.id,
        name: keyword.text,
        keyword,
        volume,
        x: Math.cos(angle) * (200 + offset),
        y: Math.sin(angle) * (200 + offset),
        symbolSize: 16 + Math.min(34, Math.log10(volume + 1) * 7),
        itemStyle: {
          color: displayBucket(keyword.latestRanks[selectedRegion]?.rank).color,
          borderColor: "#fff",
          borderWidth: 2,
          shadowBlur: 8,
          shadowColor: "rgba(15,23,42,0.08)",
        },
      };
    });
    return {
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
          return `${keyword.text}\n所属话题：${keyword.topicText ?? "—"}\n${REGIONS[selectedRegion].label}排名：${displayRank(keyword.latestRanks[selectedRegion])}\n${rankDescription(keyword.latestRanks[selectedRegion])}\n声量：${node.volume?.toLocaleString() ?? "—"}`;
        },
      },
      series: [
        {
          type: "graph",
          layout: "force",
          roam: true,
          draggable: true,
          data: nodes,
          links: [...edges.values()],
          label: {
            show: true,
            position: "right",
            color: "#475569",
            fontSize: 11,
            width: 150,
            overflow: "truncate",
          },
          labelLayout: { hideOverlap: true },
          lineStyle: { color: "#cbd5e1", opacity: 0.6, curveness: 0.08 },
          force: {
            initLayout: "none",
            repulsion: [160, 420],
            edgeLength: [70, 140],
            gravity: 0.12,
            layoutAnimation: false,
          },
          scaleLimit: { min: 0.3, max: 4 },
          emphasis: { focus: "adjacency", lineStyle: { width: 2 } },
        },
      ],
    };
  }, [keywords, selectedRegion]);
  useEffect(() => {
    if (!element.current || !keywords.length) return;
    const chart = echarts.init(element.current);
    instance.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      instance.current = null;
    };
  }, [keywords.length]);
  useEffect(() => {
    instance.current?.setOption(option, true);
  }, [option]);
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
