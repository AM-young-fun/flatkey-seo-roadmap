"use client";
import { useRef, useState } from "react";
import type { PageAuditPayload, PageAuditResult } from "@/lib/page-audit";
import { dashboardStore } from "@/lib/dashboard-client";

type Batch = PageAuditPayload & { preview?: PageAuditResult };
type SiteAudit = { targetDomain: PageAuditPayload["targetDomain"]; rows: PageAuditPayload["rows"] };

export function PageAuditImportPanel() {
  const input = useRef<HTMLInputElement>(null);
  const [batches, setBatches] = useState<Batch[]>([]), [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  async function readFile(file: File) {
    setBatches([]); setNotice(""); setFileName(file.name);
    try {
      const value = JSON.parse(await file.text());
      const sites: SiteAudit[] = Array.isArray(value.sites) ? value.sites : value.targetDomain && Array.isArray(value.rows) ? [value] : [];
      if (!sites.length || sites.some(site => !["flatkey.ai", "rackrate.org", "modelfit.cc"].includes(site.targetDomain) || !Array.isArray(site.rows) || !site.rows.length)) throw new Error("请选择包含网站与逐词核实结果的文件。");
      const session = crypto.randomUUID();
      setBatches(sites.flatMap(site => Array.from({ length: Math.ceil(site.rows.length / 30) }, (_, index) => ({ kind: "page-audit" as const, requestId: `page-review-${session}-${site.targetDomain.split(".")[0]}-${index}`, targetDomain: site.targetDomain, action: "preview" as const, rows: site.rows.slice(index * 30, index * 30 + 30) }))));
    } catch (error) { setNotice(error instanceof Error ? error.message : "文件读取失败"); }
  }
  async function submit(apply: boolean) {
    setBusy(true); setNotice("");
    const updated: Batch[] = [];
    try {
      for (let index = 0; index < batches.length; index++) {
        const batch = batches[index];
        setNotice(`${apply ? "正在保存" : "正在预览"} ${index + 1} / ${batches.length} 批…`);
        const response = await fetch("/api/keywords/page-audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...batch, preview: undefined, action: apply ? "apply" : "preview", expectedStateHash: apply ? batch.preview?.stateHash : undefined }) });
        const result = await response.json();
        if (!response.ok) throw new Error(`${batch.targetDomain}：${result.message ?? "保存失败"}${result.errors?.length ? `（${result.errors[0].message}）` : ""}`);
        updated.push({ ...batch, preview: result });
      }
      if (apply) {
        for (const siteDomain of [...new Set(batches.map(batch => batch.targetDomain))]) {
          const preview = await fetch("/api/keywords/okr/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteDomain, action: "preview" }) });
          const planned = await preview.json();
          if (!preview.ok) throw new Error(`${siteDomain} 页面任务：${planned.message ?? "预览失败"}`);
          const response = await fetch("/api/keywords/okr/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteDomain, action: "apply", expectedStateHash: planned.stateHash }) });
          const result = await response.json();
          if (!response.ok) throw new Error(`${siteDomain} 页面任务：${result.message ?? "保存失败"}`);
        }
        dashboardStore.clear(); window.dispatchEvent(new Event("seo-rankings-updated"));
        setBatches([]); setNotice(`已保存 ${batches.reduce((sum, batch) => sum + batch.rows.length, 0)} 条页面核实结果，并按页面合并任务。未执行排名抓取。`);
      } else { setBatches(updated); setNotice("预览完成，确认下方结果后保存。"); }
    } catch (error) { setNotice(`${error instanceof Error ? error.message : "操作失败"}${apply ? "；已成功保存的批次会保留，可重新预览后继续。" : ""}`); }
    finally { setBusy(false); }
  }
  const previewed = batches.length > 0 && batches.every(batch => batch.preview);
  const counts = batches.flatMap(batch => batch.rows).reduce((total, row) => ({ ...total, [row.verdict]: (total[row.verdict] ?? 0) + 1 }), {} as Record<string, number>);
  return <div className="pageAuditImport">
    <p>核实页面后更新关联与建设任务。</p>
    <div className="pageAuditActions"><a href="/api/keywords/page-audit" download>导出未关联词</a><button disabled={busy} onClick={() => input.current?.click()}>选择核实结果</button><input ref={input} type="file" accept=".json,application/json" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void readFile(file); event.target.value = ""; }} /></div>
    {batches.length ? <div className="pageAuditPreview"><strong>{fileName}</strong><p>{batches.reduce((sum, batch) => sum + batch.rows.length, 0)} 条网站关键词 · 已有页面 {counts.VERIFIED ?? 0} · 待优化 {counts.CONTENT_GAP ?? 0} · 待建设 {(counts.NO_MATCH ?? 0) + (counts.MISSING ?? 0)}</p><div className="pageAuditActions"><button disabled={busy} onClick={() => void submit(false)}>预览变更</button>{previewed ? <button className="pageAuditSave" disabled={busy} onClick={() => void submit(true)}>保存页面关联与任务</button> : null}</div></div> : null}
    {notice ? <p className="pageAuditNotice" role="status">{notice}</p> : null}
  </div>;
}
