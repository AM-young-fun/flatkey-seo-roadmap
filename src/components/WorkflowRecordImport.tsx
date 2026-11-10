"use client";

import { useState } from "react";
import { Alert, Button, Space, Typography } from "antd";
import { parseWorkflowReviewImport } from "@/lib/seo-workflow-import";

export default function WorkflowRecordImport({ onImported }: { onImported: () => void }) {
  const [commands, setCommands] = useState<ReturnType<typeof parseWorkflowReviewImport>>([]);
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  async function choose(file?: File) {
    setCommands([]); setFilename(""); setNotes([]); setError(null);
    if (!file) return;
    try {
      if (file.size > 12 * 1024 * 1024) throw Error("文件不能超过 12 MB，请分批导入");
      setCommands(parseWorkflowReviewImport(JSON.parse(await file.text()))); setFilename(file.name);
    } catch (error) { setError(error instanceof Error ? error.message : "文件格式不正确"); }
  }
  async function apply() {
    setBusy(true); setError(null); setNotes([]);
    let changed = false;
    try {
      for (const command of commands) {
        const response = await fetch("/api/seo/workflow", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command) });
        const saved = await response.json();
        if (!response.ok) throw Error(`${command.requestId}：${saved.error ?? saved.message ?? "保存失败"}；已成功的记录保留，重试使用原文件与请求编号。`);
        if (!saved.stored || !saved.record?.id || !saved.record?.version || saved.storage !== "database") throw Error(`${command.requestId}：未取得数据库保存回执，请核对后重试。`);
        changed = true;
        const history = await fetch(`/api/seo/workflow/history?kind=${encodeURIComponent(saved.kind)}&id=${encodeURIComponent(saved.record.id)}`, { cache: "no-store" });
        const readback = await history.json();
        if (!history.ok || !Array.isArray(readback.records) || !readback.records.some((record: { id: string; version: number }) => record.id === saved.record.id && record.version === saved.record.version)) throw Error(`${command.requestId}：已保存但读回未确认，请使用原文件重试，勿更换请求编号。`);
        setNotes(previous => [...previous, `${saved.replay ? "已存在，读回确认" : "已保存并读回"}：${saved.record.title ?? saved.record.id}（v${saved.record.version}）`]);
      }
      setCommands([]);
    } catch (error) { setError(error instanceof Error ? error.message : "导入失败，保留原文件重试"); }
    finally { setBusy(false); if (changed) onImported(); }
  }
  return <details style={{ marginTop: 16 }}><summary>导入待审执行记录</summary><Space orientation="vertical" style={{ width: "100%", marginTop: 12 }}>
    <Typography.Text type="secondary">导入按依赖顺序排列的 JSON 文件。这里只保存待处理内容，审批决定必须在审批单中操作；不会触发页面发布。</Typography.Text>
    <input aria-label="执行记录 JSON 文件" type="file" accept=".json,application/json" disabled={busy} onChange={event => void choose(event.target.files?.[0])} />
    {filename && <Typography.Text>{filename} · {commands.length} 条待导入记录</Typography.Text>}
    {commands.length > 0 && <ul style={{ maxHeight: 240, overflow: "auto" }}>{commands.map(command => { const record = command.record as {title?: string;id: string}; return <li key={command.requestId}>{command.action} · {record.title ?? record.id}</li>; })}</ul>}
    <Button disabled={!commands.length} loading={busy} onClick={() => void apply()}>保存待审记录并读回</Button>
    {error && <Alert type="error" showIcon title={error} />}
    {notes.length > 0 && <Alert type="success" title={`已确认 ${notes.length} 条记录`} description={<ul>{notes.map(note => <li key={note}>{note}</li>)}</ul>} />}
  </Space></details>;
}
