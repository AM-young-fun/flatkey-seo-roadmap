"use client";

import * as echarts from "echarts";
import { useEffect, useMemo, useRef } from "react";
import type { DashboardTopic } from "@/lib/types";
import {
  hashString,
  REGIONS,
  type SearchRegionCode
} from "@/lib/seo";

type KeywordGraphProps = {
  topics: DashboardTopic[];
  selectedRegion: SearchRegionCode;
};

type GraphNodeData = {
  id: string;
  name: string;
  topic: DashboardTopic;
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

function symbolSizeFor(volume: number): number {
  const cleanVolume = Math.max(0, volume);
  const minSize = 14;
  const smallKeywordSize = 17;
  const maxSize = 58;
  const smallKeywordVolume = 100;
  const strongKeywordVolume = 100000;

  if (cleanVolume <= smallKeywordVolume) {
    return minSize + Math.sqrt(cleanVolume / smallKeywordVolume) * (smallKeywordSize - minSize);
  }

  const ratio =
    Math.log10(cleanVolume / smallKeywordVolume) /
    Math.log10(strongKeywordVolume / smallKeywordVolume);

  return Math.min(maxSize, smallKeywordSize + ratio * (maxSize - smallKeywordSize));
}

function marketVolume(topic: DashboardTopic, region: SearchRegionCode): number {
  return topic.marketVolumes[region] ?? 0;
}

function parentIdsFor(topic: DashboardTopic): string[] {
  return topic.parentIds.length > 0 ? topic.parentIds : topic.parentId ? [topic.parentId] : [];
}

function hashRatio(value: string): number {
  return hashString(value) / 0xffffffff;
}

function fallbackPoint(topic: DashboardTopic, index: number, total: number): Point {
  const angle = hashRatio(topic.id) * Math.PI * 2;
  const radius = Math.sqrt((index + 1) / Math.max(total, 1)) * Math.max(360, Math.sqrt(total) * 78);

  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius
  };
}

function initialPositionsFor(topics: DashboardTopic[]): Map<string, Point> {
  const positions = new Map<string, Point>();
  const mainTopics = topics.filter((topic) => topic.type === "MAIN");
  const primaryTopics = mainTopics.length > 0 ? mainTopics : topics.slice(0, 1);
  const mainRadius = Math.max(300, Math.min(1100, primaryTopics.length * 15));

  primaryTopics.forEach((topic, index) => {
    const angle = (index / Math.max(primaryTopics.length, 1)) * Math.PI * 2;

    positions.set(topic.id, {
      x: Math.cos(angle) * mainRadius,
      y: Math.sin(angle) * mainRadius
    });
  });

  const childrenByParent = new Map<string, DashboardTopic[]>();

  topics.forEach((topic) => {
    const parentId = parentIdsFor(topic)[0];

    if (!parentId) {
      return;
    }

    const children = childrenByParent.get(parentId) ?? [];
    children.push(topic);
    childrenByParent.set(parentId, children);
  });

  childrenByParent.forEach((children, parentId) => {
    const parentPoint = positions.get(parentId) ?? fallbackPoint(children[0], 0, topics.length);
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

  topics.forEach((topic, index) => {
    if (!positions.has(topic.id)) {
      positions.set(topic.id, fallbackPoint(topic, index, topics.length));
    }
  });

  return positions;
}

export function KeywordGraph({ topics, selectedRegion }: KeywordGraphProps) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);

  const option = useMemo<echarts.EChartsOption>(() => {
    const largeGraph = topics.length > 250;
    const initialPositions = initialPositionsFor(topics);
    const nodes: GraphNodeData[] = topics.map((topic) => {
      const volume = marketVolume(topic, selectedRegion);
      const position = initialPositions.get(topic.id) ?? { x: 0, y: 0 };
      const mainTopic = topic.type === "MAIN";

      return {
        id: topic.id,
        name: topic.text,
        topic,
        volume,
        value: volume,
        x: position.x,
        y: position.y,
        symbol: mainTopic ? "diamond" : "circle",
        symbolSize: symbolSizeFor(volume),
        category: mainTopic ? 0 : 1,
        itemStyle: {
          color: mainTopic ? "#2563eb" : "#0891b2",
          borderColor: "#ffffff",
          borderWidth: 3,
          opacity: volume > 0 ? 1 : 0.55
        }
      };
    });

    const linkKeys = new Set<string>();
    const links = topics.flatMap((topic) => {
      const parentIds = parentIdsFor(topic);

      return parentIds.flatMap((parentId) => {
        const key = `${parentId}:${topic.id}`;

        if (linkKeys.has(key)) {
          return [];
        }

        linkKeys.add(key);
        return [
          {
            source: parentId,
            target: topic.id,
            lineStyle: {
              color: "#8b949e",
              width: topic.type === "SUB_TOPIC" ? 1.4 : 2,
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

          if (!data?.topic) {
            return "";
          }

          const typeLabel = data.topic.type === "MAIN" ? "主话题" : "子话题";

          return [
            `<strong>${data.topic.text}</strong>`,
            `类型: ${typeLabel}`,
            `${REGIONS[selectedRegion].label}声量: ${data.volume?.toLocaleString() ?? "0"}`
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
        data: ["主话题", "子话题"]
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
              name: "主话题"
            },
            {
              name: "子话题"
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
  }, [topics, selectedRegion]);

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

  if (topics.length === 0) {
    return <div className="emptyGraph">暂无话题</div>;
  }

  return <div ref={chartRef} className="keywordGraph" aria-label="话题关系图" />;
}
