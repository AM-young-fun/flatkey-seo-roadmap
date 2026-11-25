"use client";
import { UiSelect } from "./UiSelect";
import { LoaderCircle } from "lucide-react";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { closedPreset, listDateRange, previousRange, propertyToday, seoToday, SEO_REPORT_TIME_ZONE, shiftDay, validRange, yearAgoRange, type DateRange, type ListDatePreset } from "@/lib/seo-date-range";
import styles from "./SeoDateControl.module.css";

const initialRange = (today: string): DateRange => { const end = shiftDay(today, -1); return { start: shiftDay(end, -6), end }; };
export function useSeoRange(timeZone = SEO_REPORT_TIME_ZONE) {
  const today = propertyToday(timeZone);
  const [range, setRange] = useState(() => initialRange(today));
  const [comparison, setComparison] = useState<DateRange | null>(() => previousRange(initialRange(today)));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const read = () => {
      const params = new URLSearchParams(location.search), fallback = initialRange(today);
      const requested = { start: params.get("start") ?? fallback.start, end: params.get("end") ?? fallback.end };
      const next = validRange(requested) ? requested : fallback;
      const compare = { start: params.get("compareStart") ?? "", end: params.get("compareEnd") ?? "" };
      setRange(next);
      setComparison(params.get("compare") === "none" ? null : validRange(compare) ? compare : previousRange(next));
      setReady(true);
    };
    read(); addEventListener("popstate", read);
    return () => removeEventListener("popstate", read);
  }, [today]);
  const update = (next: DateRange, compare: DateRange | null) => {
    const params = new URLSearchParams(location.search);
    params.set("start", next.start); params.set("end", next.end);
    params.delete("compareStart"); params.delete("compareEnd"); params.delete("compare");
    if (compare) { params.set("compareStart", compare.start); params.set("compareEnd", compare.end); }
    else params.set("compare", "none");
    const url = location.pathname + "?" + params + location.hash;
    if (url !== location.pathname + location.search + location.hash) history.pushState(null, "", url);
    setRange(next); setComparison(compare); dispatchEvent(new PopStateEvent("popstate"));
  };
  return { range, comparison, update, today, timeZone, ready };
}

export function SeoDateControl({ value, showComparison = true, pending = false }: { value: ReturnType<typeof useSeoRange>; showComparison?: boolean; pending?: boolean }) {
  const { range, comparison, update, today, timeZone } = value;
  const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [start, setStart] = useState(range.start), [end, setEnd] = useState(range.end);
  const [compareStart, setCompareStart] = useState(""), [compareEnd, setCompareEnd] = useState("");
  const [mode, setMode] = useState("previous"), [error, setError] = useState("");
  useEffect(() => {
    setStart(range.start); setEnd(range.end);
    setCompareStart(comparison?.start ?? ""); setCompareEnd(comparison?.end ?? "");
    const same = (other: DateRange) => comparison?.start === other.start && comparison?.end === other.end;
    setMode(!comparison ? "none" : same(previousRange(range)) ? "previous" : same(yearAgoRange(range)) ? "year" : "custom");
    setError("");
  }, [range, comparison, open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Observe before the nested Select closes itself: the first Escape belongs
      // to its options; the next Escape closes this date form.
      if (root.current?.querySelector('[role="combobox"][aria-expanded="true"]')) return;
      setOpen(false); trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true); };
  }, [open]);
  const apply = (next: DateRange) => {
    if (!validRange(next)) { setError("请选择有效起止日期"); return; }
    const compare = !showComparison ? null : mode === "previous" ? previousRange(next) : mode === "year" ? yearAgoRange(next)
      : mode === "custom" ? { start: compareStart, end: compareEnd } : null;
    if (compare && !validRange(compare)) { setError("请选择有效对比日期"); return; }
    if (next.end >= today || compare && compare.end >= today) { setError("请选择已结束的日期。"); return; }
    if ([next, ...(compare ? [compare] : [])].some(r => Date.parse(r.end) - Date.parse(r.start) > 365 * 86400000)) { setError("一次最多查询 366 天，请缩短日期范围。"); return; }
    update(next, compare); setOpen(false); trigger.current?.focus();
  };
  const latest = shiftDay(today, -1);
  const recent = (days: number) => apply({ start: shiftDay(latest, 1-days), end: latest });
  const days = (Date.parse(range.end) - Date.parse(range.start)) / 86400000 + 1;
  const recentLabel = range.end === latest && [7,30,90].includes(days) ? `近 ${days} 天 · ` : "";
  return <div className={styles.root} ref={root}>
    <button ref={trigger} type="button" className={styles.trigger} aria-label="选择时间" aria-busy={pending || undefined} aria-expanded={open} onClick={() => setOpen(!open)}>{recentLabel}{range.start} — {range.end}{pending ? <LoaderCircle size={14} className="feedback-spinner" aria-hidden="true" /> : <span aria-hidden="true">⌄</span>}</button>
    {open ? <section className={styles.menu} aria-label="时间选择">
      <div className={styles.quick}>{[7,30,90].map(days => <button type="button" key={days} onClick={() => recent(days)}>近 {days} 天</button>)}
        {([['yesterday','昨天'],['week','本周'],['lastWeek','上周'],['month','本月']] as const).map(([key,label]) => <button type="button" key={key} onClick={() => { const next = closedPreset(key, today); if (next) apply(next); else setError("该周期尚无已结束日"); }}>{label}</button>)}
      </div>
      <div className={styles.dates}><label>开始日期<input type="date" aria-label="开始日期" value={start} max={latest} onInput={e => setStart(e.currentTarget.value)} onChange={e => setStart(e.target.value)} /></label><label>结束日期<input type="date" aria-label="结束日期" value={end} max={latest} onInput={e => setEnd(e.currentTarget.value)} onChange={e => setEnd(e.target.value)} /></label></div>
      {showComparison ? <label className={styles.compare}>对比<UiSelect className={styles.compareSelect} aria-label="对比方式" value={mode} onChange={setMode} getPopupContainer={node => root.current ?? node.parentElement!} options={[{ value: "previous", label: "上一等长周期" }, { value: "none", label: "不对比" }, { value: "year", label: "去年同期" }, { value: "custom", label: "自定义区间" }]} /></label> : null}
      {showComparison && mode === "custom" ? <div className={styles.dates}><label>对比开始<input aria-label="对比开始" type="date" value={compareStart} onInput={e => setCompareStart(e.currentTarget.value)} onChange={e => setCompareStart(e.target.value)} /></label><label>对比结束<input aria-label="对比结束" type="date" value={compareEnd} onInput={e => setCompareEnd(e.currentTarget.value)} onChange={e => setCompareEnd(e.target.value)} /></label></div> : null}
      {error ? <p role="alert" className={styles.error}>{error}</p> : <p className={styles.note}>{timeZone === "Asia/Shanghai" ? "按北京时间选择已结束日" : "按洛杉矶时间统计已结束日"}</p>}
      <button type="button" className={styles.apply} onClick={() => apply({start,end})}>应用日期</button>
    </section> : null}
  </div>;
}

const listPresets = { all: "全部", week: "本周", month: "本月" } as const;
export const listDateParamKeys = ["range", "rangeStart", "rangeEnd"] as const;
export function useSeoListDateRange(week: "calendar" | "work" = "calendar") {
  const params = useSearchParams();
  const today = seoToday();
  const choice = params.get("range");
  const preset = choice === "all" || choice === "week" || choice === "month" || choice === "custom" ? choice : week === "work" ? "week" : "all";
  const range = listDateRange(preset, today, { start: params.get("rangeStart") ?? "", end: params.get("rangeEnd") ?? "" }, week);
  function apply(next: ListDatePreset, custom?: DateRange) {
    const query = new URLSearchParams(location.search);
    listDateParamKeys.forEach(key => query.delete(key));
    if (week === "work") query.delete("page");
    if (next !== "all" || week === "work") query.set("range", next);
    if (next === "custom" && custom) {
      query.set("rangeStart", custom.start);
      query.set("rangeEnd", custom.end);
    }
    history.pushState(null, "", location.pathname + (query.size ? "?" + query : "") + location.hash);
  }
  return { preset, range, today, apply } as const;
}

export function SeoListDateControl({ value, pending = false }: { value: ReturnType<typeof useSeoListDateRange>; pending?: boolean }) {
  const { preset, range, today, apply } = value;
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(""), [end, setEnd] = useState("");
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  const choose = (next: ListDatePreset, custom?: DateRange) => {
    apply(next, custom);
    setOpen(false);
    trigger.current?.focus();
  };
  const label = preset === "custom" && range ? range.start + " — " + range.end : listPresets[preset === "custom" ? "all" : preset];
  return <div className={styles.root} ref={root}>
    <button ref={trigger} type="button" className={styles.trigger} aria-label="筛选日期" aria-busy={pending || undefined} aria-expanded={open} onClick={() => {
      if (!open) { setStart(range?.start ?? today); setEnd(range?.end ?? today); setError(""); }
      setOpen(!open);
    }}>{label}{pending ? <LoaderCircle size={14} className="feedback-spinner" aria-hidden="true" /> : <span aria-hidden="true">⌄</span>}</button>
    {open ? <form className={styles.menu} aria-label="自定义日期范围" onSubmit={event => {
      event.preventDefault();
      if (!validRange({ start, end })) { setError("请选择有效的起止日期"); return; }
      choose("custom", { start, end });
    }}>
      <div className={styles.quick}>{(Object.keys(listPresets) as (keyof typeof listPresets)[]).map(key =>
        <button type="button" key={key} aria-pressed={preset === key} onClick={() => choose(key)}>{listPresets[key]}</button>)}</div>
      <div className={styles.dates}>
        <label>开始日期<input type="date" value={start} onInput={event => setStart(event.currentTarget.value)} required /></label>
        <label>结束日期<input type="date" value={end} onInput={event => setEnd(event.currentTarget.value)} required /></label>
      </div>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      <button type="submit" className={styles.apply}>应用日期</button>
    </form> : null}
  </div>;
}
