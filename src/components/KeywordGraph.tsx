"use client";

import * as echarts from "echarts";
import { useEffect, useMemo, useRef } from "react";
import type { DashboardKeyword } from "@/lib/types";
import {
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
  symbol: "diamond" | "circle";
  symbolSize: number;
  category: number;
  itemStyle: {
    color: string;
    borderColor: string;
    borderWidth: number;
  };
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

export function KeywordGraph({ keywords, selectedRegion }: KeywordGraphProps) {
  const chartRef = useRef<HTMLDivElement | null>(null);

  const option = useMemo<echarts.EChartsOption>(() => {
    const maxVolume = Math.max(
      ...keywords.map((keyword) => marketVolume(keyword, selectedRegion)),
      1
    );
    const nodes: GraphNodeData[] = keywords.map((keyword) => {
      const rank = keyword.latestRanks[selectedRegion];
      const bucket = rank?.bucket ?? "NOT_FOUND";
      const volume = marketVolume(keyword, selectedRegion);

      return {
        id: keyword.id,
        name: keyword.text,
        keyword,
        rankText: rankLabel(rank?.rank),
        volume,
        value: volume,
        symbol: keyword.type === "MAIN" ? "diamond" : "circle",
        symbolSize: symbolSizeFor(volume, maxVolume),
        category: keyword.type === "MAIN" ? 0 : 1,
        itemStyle: {
          color: RANK_BUCKET_META[bucket].color,
          borderColor: "#ffffff",
          borderWidth: 3
        }
      };
    });

    const linkKeys = new Set<string>();
    const links = keywords.flatMap((keyword) => {
      const parentIds =
        keyword.parentIds.length > 0 ? keyword.parentIds : keyword.parentId ? [keyword.parentId] : [];

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
            `${REGIONS[selectedRegion].label}: ${rankLabel(rank?.rank)}`,
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
            repulsion: 220,
            edgeLength: [72, 170],
            gravity: 0.08,
            friction: 0.32
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

    chart.setOption(option, true);

    const resizeObserver = new ResizeObserver(() => {
      chart.resize();
    });

    resizeObserver.observe(chartRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
    };
  }, [option]);

  if (keywords.length === 0) {
    return <div className="emptyGraph">暂无关键词</div>;
  }

  return <div ref={chartRef} className="keywordGraph" aria-label="关键词关系图" />;
}
