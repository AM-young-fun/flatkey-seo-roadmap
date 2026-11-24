"use client";
import { useMemo, useRef, useState } from "react";
import type { GrowthTarget, GrowthWorkspace } from "@/lib/growth-types";
import { growthLink, growthMarketLabel, growthRankKind, growthRankText, type GrowthScope } from "./growth-topic-view";
import { keywordCircleLayout, type KeywordPoint } from "./growth-network-layout";
import styles from "./GrowthKeywordNetwork.module.css";
import { SeoAnchor } from "@/components/SeoAnchor";


export function GrowthKeywordNetwork({ data, scope, targets }: { data: GrowthWorkspace; scope: GrowthScope; targets: GrowthTarget[] }) {
  const layout = useMemo(() => keywordCircleLayout(data.targets, data.topics), [data.targets, data.topics]);
  const visible = new Set(targets.map(target => target.id));
  const [hover, setHover] = useState<KeywordPoint | null>(null), [zoom, setZoom] = useState(1), [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; origin: typeof offset; moved: boolean } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const points = layout.points.filter(point => visible.has(point.target.id));
  const clusters = layout.clusters.filter(cluster => points.some(point => point.clusterId === cluster.id));
  const reset = () => { setZoom(1); setOffset({ x: 0, y: 0 }); };
  return <section aria-label="按话题分簇的关键词关系图" className={styles.root}>
    <header><div><h2>业务词库关系图</h2><p>{points.length.toLocaleString()} 个关键词 · {clusters.length.toLocaleString()} 个话题簇 · 每词一个点</p></div><div className={styles.controls}><button type="button" aria-label="缩小关系图" onClick={() => setZoom(value => Math.max(.7, value / 1.3))}>−</button><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="放大关系图" onClick={() => setZoom(value => Math.min(6, value * 1.3))}>＋</button><button type="button" onClick={reset}>复位</button></div></header>
    <div className={styles.legend}>{[["top10", "1–10"], ["top30", "11–30"], ["top50", "31–50"], ["top100", "51–100"], ["unknown", "暂无有效前100证据"]].map(([kind, label]) => <span key={kind}><i data-kind={kind} />{label}</span>)}</div>
    <div className={styles.canvas}>
      <svg ref={svg} viewBox="0 0 600 600" role="group" aria-label={`${points.length}个关键词的完整圆形话题图，支持缩放拖动；点击关键词查看对应话题明细`}
        onPointerDown={event => { if (event.button !== 0) return; drag.current = { x: event.clientX, y: event.clientY, origin: offset, moved: false }; }}
        onPointerMove={event => { if (!drag.current) return; const factor = 600 / (svg.current?.getBoundingClientRect().width || 600), dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y; if (Math.abs(dx) + Math.abs(dy) > 5) { drag.current.moved = true; setHover(null); setOffset({ x: drag.current.origin.x + dx * factor, y: drag.current.origin.y + dy * factor }); } }}
        onPointerUp={() => { if (!drag.current?.moved) drag.current = null; }} onPointerLeave={() => { drag.current = null; }}
        onWheel={event => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); setZoom(value => Math.max(.7, Math.min(6, value * (event.deltaY < 0 ? 1.15 : 1 / 1.15)))); } }}>
        <circle cx="300" cy="300" r="285" fill="#fafcff" stroke="#edf1f7" />
        <g transform={`translate(${offset.x} ${offset.y}) translate(300 300) scale(${zoom}) translate(-300 -300)`}>
          {clusters.map(cluster => <g key={cluster.id}><circle className={styles.cluster} cx={cluster.x} cy={cluster.y} r={cluster.radius} /><text className={styles.clusterLabel} x={cluster.x} y={cluster.y - cluster.radius - 3} textAnchor="middle">{cluster.topic?.name ?? "话题待关联"}</text></g>)}
          {points.map(point => <SeoAnchor key={point.target.id} href={growthLink(scope, point.topic ?? undefined, point.target.id)} onClick={event => { if (drag.current?.moved) { event.preventDefault(); drag.current = null; } }} onFocus={() => setHover(point)} onBlur={() => setHover(null)} onMouseEnter={() => setHover(point)} onMouseLeave={() => setHover(null)}>
            <circle className={styles.point} cx={point.x} cy={point.y} r={point.radius} data-kind={growthRankKind(point.target)} data-keyword-id={point.target.id} />
            <title>{`${point.target.keyword} · ${point.topic?.name ?? "话题待关联"} · ${growthMarketLabel(data, point.target.country, point.target.language)} · ${growthRankText(point.target)}`}</title>
          </SeoAnchor>)}
        </g>
      </svg>
      {hover ? <aside className={styles.tooltip} role="status"><strong>{hover.target.keyword}</strong><span>{hover.topic?.name ?? "话题待关联"} · {hover.target.site}</span><span>{growthMarketLabel(data, hover.target.country, hover.target.language)} · {growthRankText(hover.target)}</span><span>{hover.target.pageState === "published" ? "已建页面" : hover.target.pageState === "planned" ? "已规划页面" : "页面待关联"} · {hover.target.checkedAt ? `实测 ${hover.target.checkedAt.slice(0, 10)}` : "采样待齐"}</span><span>{hover.target.rankUrl ?? hover.target.publishedUrls[0] ?? "页面地址待关联"}</span><small>点击进入话题下的原关键词、页面和任务</small></aside> : null}
      {!points.length ? <p className={styles.empty}>当前筛选没有可展示的季度关键词。</p> : null}
    </div>
    <p className={styles.note}>每个词仅按主话题显示一次；关联话题在详情中浏览。位置由关键词与话题身份稳定计算，排名仅改变颜色。灰色包含未采集、过期、待核及已查100名外，悬停查看具体区别。按钮缩放、拖动平移，Ctrl / ⌘＋滚轮缩放。</p>
  </section>;
}
