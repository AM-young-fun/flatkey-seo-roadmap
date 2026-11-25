"use client";
import { useMemo, useRef, useState } from "react";
import type { GrowthTarget, GrowthWorkspace } from "@/lib/growth-types";
import { growthLink, growthMarketLabel, growthRankKind, growthRankText, type GrowthScope } from "./growth-topic-view";
import { keywordCircleLayout, type TopicCircle } from "./growth-network-layout";
import styles from "./GrowthKeywordNetwork.module.css";
import { SeoAnchor } from "@/components/SeoAnchor";

const initialView = { clusterId: null as string | null, zoom: 1, x: 0, y: 0 };
const focusZoom = (radius: number) => Math.max(1.1, Math.min(24, 220 / radius));
const clusterName = (cluster: TopicCircle) => cluster.topic?.name ?? "话题待关联";

export function GrowthKeywordNetwork({ data, scope, targets }: { data: GrowthWorkspace; scope: GrowthScope; targets: GrowthTarget[] }) {
  const layout = useMemo(() => keywordCircleLayout(data.targets, data.topics), [data.targets, data.topics]);
  const [view, setView] = useState(initialView), [hoverId, setHoverId] = useState<string | null>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; moved: boolean; origin: typeof initialView } | null>(null);
  const suppressPointerClick = useRef(false);
  const resetButton = useRef<HTMLButtonElement>(null);
  const visible = new Set(targets.map(target => target.id));
  const visiblePoints = layout.points.filter(point => visible.has(point.target.id));
  const visibleClusters = new Set(visiblePoints.map(point => point.clusterId));
  const focused = layout.clusters.find(cluster => cluster.id === view.clusterId && visibleClusters.has(cluster.id));
  const { zoom, x, y } = view.clusterId && !focused ? initialView : view;
  const points = focused ? visiblePoints.filter(point => point.clusterId === focused.id) : visiblePoints;
  const clusters = focused ? [focused] : layout.clusters.filter(cluster => visibleClusters.has(cluster.id));
  const hover = points.find(point => point.target.id === hoverId);
  const reset = () => { setView(initialView); setHoverId(null); };
  const focus = (cluster: TopicCircle) => {
    const zoom = focusZoom(cluster.radius);
    setHoverId(null);
    setView({ clusterId: cluster.id, zoom, x: (300 - cluster.x) * zoom, y: (300 - cluster.y) * zoom });
    resetButton.current?.focus({ preventScroll: true });
  };
  const scale = (factor: number) => {
    const next = Math.max(.7, Math.min(focused ? Math.max(6, focusZoom(focused.radius) * 2) : 6, zoom * factor));
    setView({ clusterId: focused?.id ?? null, zoom: next, x: x * next / zoom, y: y * next / zoom });
  };
  return <section aria-label="按话题分簇的关键词关系图" className={styles.root}
    onKeyDown={event => { if (focused && event.key === "Escape") { event.preventDefault(); reset(); resetButton.current?.focus(); } }}>
    <header>
      <div><h2>业务词库关系图</h2><p aria-live="polite">{focused ? `${clusterName(focused)} · ` : ""}{points.length.toLocaleString()} 个关键词{focused ? "" : ` · ${clusters.length.toLocaleString()} 个话题簇 · 每词一个点`}</p></div>
      <div className={styles.controls}>
        <button type="button" aria-label="缩小关系图" onClick={() => scale(1 / 1.3)}>−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="放大关系图" onClick={() => scale(1.3)}>＋</button>
        <button ref={resetButton} type="button" onClick={reset}>{focused ? "返回全图" : "复位"}</button>
      </div>
    </header>
    <div className={styles.legend}>{[["top10", "1–10"], ["top30", "11–30"], ["top50", "31–50"], ["top100", "51–100"], ["unknown", "暂无有效前100证据"]].map(([kind, label]) => <span key={kind}><i data-kind={kind} />{label}</span>)}</div>
    <div className={styles.workspace} data-focused={Boolean(focused)}>
    <div className={styles.canvas}>
      <svg viewBox="0 0 600 600" role="group" aria-label={focused ? `${clusterName(focused)}的${points.length}个关键词` : `${points.length}个关键词的圆形话题图，点击话题簇放大`}
        onPointerDown={event => {
          if (event.button !== 0 || event.isPrimary === false) return;
          suppressPointerClick.current = false;
          drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, origin: { clusterId: focused?.id ?? null, zoom, x, y }, moved: false };
        }}
        onPointerMove={event => {
          const gesture = drag.current;
          if (!gesture || gesture.pointerId !== event.pointerId) return;
          const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
          if (!gesture.moved && Math.hypot(dx, dy) <= 5) return;
          if (!gesture.moved) { event.currentTarget.setPointerCapture(event.pointerId); gesture.moved = true; suppressPointerClick.current = true; setHoverId(null); }
          const { width, height } = event.currentTarget.getBoundingClientRect();
          const factor = 600 / (Math.min(width, height) || 600);
          setView({ ...gesture.origin, x: gesture.origin.x + dx * factor, y: gesture.origin.y + dy * factor });
        }}
        onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { if (!drag.current?.moved) drag.current = null; }}
        onPointerCancel={() => { drag.current = null; suppressPointerClick.current = false; }}
        onClickCapture={event => { if (event.detail > 0 && suppressPointerClick.current) { event.preventDefault(); event.stopPropagation(); suppressPointerClick.current = false; } }}
        onWheel={event => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); scale(event.deltaY < 0 ? 1.15 : 1 / 1.15); } }}>
        {focused ? null : <circle cx="300" cy="300" r="285" fill="#fafcff" stroke="#edf1f7" />}
        <g transform={`translate(${x} ${y}) translate(300 300) scale(${zoom}) translate(-300 -300)`}>
          {clusters.map(cluster => <g key={cluster.id} className={focused ? undefined : styles.clusterTrigger}
            role={focused ? undefined : "button"} tabIndex={focused ? undefined : 0} aria-label={focused ? undefined : `放大话题 ${clusterName(cluster)}`}
            onClick={focused ? undefined : () => focus(cluster)} onKeyDown={focused ? undefined : event => {
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); focus(cluster); }
            }}><circle className={styles.cluster} cx={cluster.x} cy={cluster.y} r={cluster.radius} vectorEffect="non-scaling-stroke" />
            {focused ? null : <text className={styles.clusterLabel} x={cluster.x} y={cluster.y - cluster.radius - 3} textAnchor="middle">{clusterName(cluster)}</text>}</g>)}
          {points.map(point => <SeoAnchor key={point.target.id} href={growthLink(scope, point.topic ?? undefined, point.target.id)} aria-label={point.target.keyword} tabIndex={focused ? -1 : undefined}
            onFocus={() => setHoverId(point.target.id)} onBlur={() => setHoverId(null)} onMouseEnter={() => setHoverId(point.target.id)} onMouseLeave={() => setHoverId(null)}>
            <circle className={styles.point} cx={point.x} cy={point.y} r={focused ? 5 / zoom : point.radius} data-kind={growthRankKind(point.target)} data-keyword-id={point.target.id} vectorEffect="non-scaling-stroke" />
            <title>{`${point.target.keyword} · ${point.topic?.name ?? "话题待关联"} · ${growthMarketLabel(data, point.target.country, point.target.language)} · ${growthRankText(point.target)}`}</title>
          </SeoAnchor>)}
        </g>
      </svg>
      {hover ? <aside className={styles.tooltip} role="status"><strong>{hover.target.keyword}</strong><span>{hover.topic?.name ?? "话题待关联"} · {hover.target.site}</span><span>{growthMarketLabel(data, hover.target.country, hover.target.language)} · {growthRankText(hover.target)}</span><span>{hover.target.pageState === "published" ? "已建页面" : hover.target.pageState === "planned" ? "已规划页面" : "页面待关联"} · {hover.target.checkedAt ? `实测 ${hover.target.checkedAt.slice(0, 10)}` : "采样待齐"}</span><span>{hover.target.rankUrl ?? hover.target.publishedUrls[0] ?? "页面地址待关联"}</span><small>点击进入话题下的原关键词、页面和任务</small></aside> : null}
      {!points.length ? <p className={styles.empty}>当前筛选没有可展示的季度关键词。</p> : null}
    </div>
      {focused ? <aside className={styles.keywordList} aria-label={`${clusterName(focused)}的关键词列表`}>
        <h3>{clusterName(focused)}</h3>
        {focused.topic ? <SeoAnchor href={growthLink(scope, focused.topic)}>打开话题详情 →</SeoAnchor> : null}
        <ul>{points.map(point => <li key={point.target.id}>
          <SeoAnchor href={growthLink(scope, point.topic ?? undefined, point.target.id)}>{point.target.keyword}</SeoAnchor>
          <span>{growthMarketLabel(data, point.target.country, point.target.language)} · {growthRankText(point.target)}</span>
        </li>)}</ul>
      </aside> : null}
    </div>
    <p className={styles.note}>{focused ? "点关键词查看页面与任务，按 Esc 返回全图。" : "点击话题簇放大并查看关键词。关联话题在详情中浏览。"} 支持拖动平移、按钮缩放和 Ctrl / ⌘＋滚轮缩放。</p>
  </section>;
}
