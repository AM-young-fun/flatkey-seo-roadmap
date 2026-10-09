"use client";

import * as echarts from "echarts";
import { useEffect, useMemo, useRef } from "react";
import type { DashboardKeyword, RankSummary } from "@/lib/types";
import {
  hashString,
  rankDeltaLabel,
  rankLabel,
  RANK_BUCKET_META,
  REGIONS,
  type SearchRegionCode
} from "@/lib/seo";

type KeywordGraphProps = {
  keywords: DashboardKeyword[];
  selectedRegion: SearchRegionCode;
};

type GraphNodeData = {
  id: string;
  name: string;
  keyword: DashboardKeyword;
  rankText: string;
  volume: number;
  value: number;
  x: number;
  y: number;
  symbol: "diamond" | "circle";
  symbolSize: number;
  category: number;
  itemStyle: {
    color: string;
    borderColor: string;
    borderWidth: number;
    opacity: number;
  };
};

type Point = {
  x: number;
  y: number;
};

type TooltipParam = {
  data?: Partial<GraphNodeData> & {
    source?: string;
    target?: string;
  };
};

function symbolSizeFor(volume: number, maxVolume: number): number {
  if (maxVolume <= 0) {
    return 34;
  }

  const ratio = Math.sqrt(volume / maxVolume);
  return Math.max(30, Math.min(82, 30 + ratio * 52));
}

function marketVolume(keyword: DashboardKeyword, region: SearchRegionCode): number {
  return keyword.marketVolumes[region] ?? keyword.latestRanks[region]?.searchVolume ?? 0;
}

function rankStatusLabel(rank: RankSummary | null | undefined): string {
  return rank ? rankLabel(rank.rank) : "未同步";
}

function parentIdsFor(keyword: DashboardKeyword): string[] {
  return keyword.parentIds.length > 0 ? keyword.parentIds : keyword.parentId ? [keyword.parentId] : [];
}

function hashRatio(value: string): number {
  return hashString(value) / 0xffffffff;
}

function fallbackPoint(keyword: DashboardKeyword, index: number, total: number): Point {
  const angle = hashRatio(keyword.id) * Math.PI * 2;
  const radius = Math.sqrt((index + 1) / Math.max(total, 1)) * Math.max(360, Math.sqrt(total) * 78);

  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius
  };
}

function initialPositionsFor(keywords: DashboardKeyword[]): Map<string, Point> {
  const positions = new Map<string, Point>();
  const mainKeywords = keywords.filter((keyword) => keyword.type === "MAIN");
  const primaryKeywords = mainKeywords.length > 0 ? mainKeywords : keywords.slice(0, 1);
  const mainRadius = Math.max(300, Math.min(1100, primaryKeywords.length * 15));

  primaryKeywords.forEach((keyword, index) => {
    const angle = (index / Math.max(primaryKeywords.length, 1)) * Math.PI * 2;

    positions.set(keyword.id, {
      x: Math.cos(angle) * mainRadius,
      y: Math.sin(angle) * mainRadius
    });
  });

  const childrenByParent = new Map<string, DashboardKeyword[]>();

  keywords.forEach((keyword) => {
    const parentId = parentIdsFor(keyword)[0];

    if (!parentId) {
      return;
    }

    const children = childrenByParent.get(parentId) ?? [];
    children.push(keyword);
    childrenByParent.set(parentId, children);
  });

  childrenByParent.forEach((children, parentId) => {
    const parentPoint = positions.get(parentId) ?? fallbackPoint(children[0], 0, keywords.length);
    const childRadius = Math.max(115, Math.min(460, Math.sqrt(children.length) * 58));

    children.forEach((child, index) => {
      if (positions.has(child.id)) {
        return;
      }

      const angle = ((index + hashRatio(child.id)) / Math.max(children.length, 1)) * Math.PI * 2;
      const ringOffset = 0.72 + (index % 4) * 0.14;

      positions.set(child.id, {
        x: parentPoint.x + Math.cos(angle) * childRadius * ringOffset,
        y: parentPoint.y + Math.sin(angle) * childRadius * ringOffset
      });
    });
  });

  keywords.forEach((keyword, index) => {
    if (!positions.has(keyword.id)) {
      positions.set(keyword.id, fallbackPoint(keyword, index, keywords.length));
    }
  });

  return positions;
}

export function KeywordGraph({ keywords, selectedRegion }: KeywordGraphProps) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);

  const option = useMemo<echarts.EChartsOption>(() => {
    const largeGraph = keywords.length > 250;
    const initialPositions = initialPositionsFor(keywords);
    const maxVolume = Math.max(
      ...keywords.map((keyword) => marketVolume(keyword, selectedRegion)),
      1
    );
    const nodes: GraphNodeData[] = keywords.map((keyword) => {
      const rank = keyword.latestRanks[selectedRegion];
      const bucket = rank?.bucket ?? "NOT_FOUND";
      const volume = marketVolume(keyword, selectedRegion);
      const position = initialPositions.get(keyword.id) ?? { x: 0, y: 0 };

      return {
        id: keyword.id,
        name: keyword.text,
        keyword,
        rankText: rankLabel(rank?.rank),
        volume,
        value: volume,
        x: position.x,
        y: position.y,
        symbol: keyword.type === "MAIN" ? "diamond" : "circle",
        symbolSize: symbolSizeFor(volume, maxVolume),
        category: keyword.type === "MAIN" ? 0 : 1,
        itemStyle: {
          color: RANK_BUCKET_META[bucket].color,
          borderColor: "#ffffff",
          borderWidth: 3,
          opacity: rank ? 1 : 0.5
        }
      };
    });

    const linkKeys = new Set<string>();
    const links = keywords.flatMap((keyword) => {
      const parentIds = parentIdsFor(keyword);

      return parentIds.flatMap((parentId) => {
        const key = `${parentId}:${keyword.id}`;

        if (linkKeys.has(key)) {
          return [];
        }

        linkKeys.add(key);
        return [
          {
            source: parentId,
            target: keyword.id,
            lineStyle: {
              color: "#8b949e",
              width: keyword.type === "LONG_TAIL" ? 1.4 : 2,
              opacity: 0.72
            }
          }
        ];
      });
    });

    return {
      backgroundColor: "transparent",
      animationDurationUpdate: 450,
      tooltip: {
        trigger: "item",
        borderWidth: 0,
        backgroundColor: "#16181d",
        textStyle: {
          color: "#ffffff",
          fontFamily: "inherit"
        },
        formatter: (rawParam: unknown) => {
          const param = rawParam as TooltipParam;
          const data = param.data;

          if (!data?.keyword) {
            return "";
          }

          const rank = data.keyword.latestRanks[selectedRegion];
          const typeLabel = data.keyword.type === "MAIN" ? "主关键词" : "长尾关键词";
          const delta = rankDeltaLabel(rank?.rankDelta);

          return [
            `<strong>${data.keyword.text}</strong>`,
            `${REGIONS[selectedRegion].label}: ${rankStatusLabel(rank)}`,
            `类型: ${typeLabel}`,
            `声量: ${data.volume?.toLocaleString() ?? "0"}`,
            `Diff: ${delta}`
          ].join("<br/>");
        }
      },
      legend: {
        top: 0,
        left: 0,
        itemWidth: 12,
        itemHeight: 12,
        textStyle: {
          color: "#4b5563",
          fontFamily: "inherit"
        },
        data: ["主关键词", "长尾关键词"]
      },
      series: [
        {
          type: "graph",
          layout: "force",
          left: "center",
          top: "center",
          width: "94%",
          height: "94%",
          preserveAspect: "contain",
          preserveAspectAlign: "center",
          preserveAspectVerticalAlign: "middle",
          center: ["50%", "50%"],
          zoom: largeGraph ? 0.82 : 1,
          scaleLimit: {
            min: 0.25,
            max: 4
          },
          nodeScaleRatio: largeGraph ? 0.38 : 0.55,
          roam: true,
          draggable: true,
          data: nodes,
          links,
          categories: [
            {
              name: "主关键词"
            },
            {
              name: "长尾关键词"
            }
          ],
          edgeSymbol: ["none", "arrow"],
          edgeSymbolSize: 8,
          label: {
            show: true,
            position: "right",
            formatter: "{b}",
            color: "#1f2937",
            fontFamily: "inherit",
            fontSize: 12,
            width: 150,
            overflow: "truncate"
          },
          labelLayout: {
            hideOverlap: true
          },
          force: {
            initLayout: "none",
            repulsion: largeGraph ? [90, 360] : [130, 420],
            edgeLength: largeGraph ? [42, 120] : [72, 170],
            gravity: largeGraph ? 0.22 : 0.1,
            friction: largeGraph ? 0.48 : 0.36,
            layoutAnimation: false
          },
          emphasis: {
            focus: "adjacency",
            lineStyle: {
              width: 3
            }
          }
        }
      ]
    };
  }, [keywords, selectedRegion]);

  useEffect(() => {
    if (!chartRef.current) {
      return;
    }

    const chart = echarts.init(chartRef.current, null, {
      renderer: "canvas"
    });
    chartInstanceRef.current = chart;

    const resizeObserver = new ResizeObserver(() => {
      chart.resize();
    });

    resizeObserver.observe(chartRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartInstanceRef.current;

    if (!chart) {
      return;
    }

    chart.setOption(option, true);
    chart.resize();
  }, [option]);

  if (keywords.length === 0) {
    return <div className="emptyGraph">暂无关键词</div>;
  }

  return <div ref={chartRef} className="keywordGraph" aria-label="关键词关系图" />;
}
