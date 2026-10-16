"use client";
import { FormEvent, useState } from "react";
import {
  Check,
  Clock3,
  Copy,
  Download,
  FileSpreadsheet,
  Layers3,
  Loader2,
  Plus,
  Upload,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useSeoSelection } from "@/components/useSeoSelection";
import { useDashboard } from "@/components/useDashboard";
import type { TopicType } from "@/lib/types";
import { postImportBatch } from "@/lib/import-client";
import { KeywordReviewPanel } from "@/components/KeywordReviewPanel";
import { DataforSeoConnection } from "@/components/DataforSeoConnection";
const initialTopicForm = { text: "", type: "MAIN" as TopicType, parentId: "" };
type ImportKeywordsResponse = {
  message?: string;
  created?: number;
  updated?: number;
  skipped?: number;
  errors?: Array<{ row: number; message: string }>;
};
export function ManagementDashboard() {
  const selection = useSeoSelection();
  const { data, refresh: loadDashboard, error } = useDashboard(selection.site, selection.source);
  const [jsonText, setJsonText] = useState("");
  const [jsonFile, setJsonFile] = useState<File | null>(null);
  const [importProgress, setImportProgress] = useState("");
  const [importReceipts, setImportReceipts] = useState<unknown[]>([]);
  const [credential, setCredential] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [credentialStatus, setCredentialStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [topicForm, setTopicForm] = useState(initialTopicForm);
  const [topicImportFile, setTopicImportFile] = useState<File | null>(null);
  const [keywordImportFile, setKeywordImportFile] = useState<File | null>(null);
  const [topicFileInputKey, setTopicFileInputKey] = useState(0);
  const [keywordFileInputKey, setKeywordFileInputKey] = useState(0);
  const mainTopics =
    data?.topics.filter((topic) => topic.type === "MAIN") ?? [];
  async function submitTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch("/api/topics", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          siteDomain: "flatkey.ai",
          text: topicForm.text,
          type: topicForm.type,
          parentId:
            topicForm.type === "SUB_TOPIC" ? topicForm.parentId || null : null,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        created?: boolean;
      };

      if (!response.ok) {
        throw new Error(payload.message ?? "新增失败");
      }

      setTopicForm(initialTopicForm);
      setMessage(payload.created === false ? "话题已更新" : "话题已新增");
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "新增失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function importCsv(
    event: FormEvent<HTMLFormElement>,
    options: {
      file: File | null;
      endpoint: string;
      label: string;
      reset: () => void;
    },
  ) {
    event.preventDefault();

    if (!options.file) {
      setMessage("请选择 CSV 文件");
      return;
    }

    setImporting(true);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", options.file);
      formData.append("siteDomain", "flatkey.ai");

      const response = await fetch(options.endpoint, {
        method: "POST",
        body: formData,
      });
      const payload = (await response
        .json()
        .catch(() => ({}))) as ImportKeywordsResponse;

      if (!response.ok) {
        throw new Error(payload.message ?? "导入失败");
      }

      const created = payload.created ?? 0;
      const updated = payload.updated ?? 0;
      const skipped = payload.skipped ?? 0;
      const firstError = payload.errors?.[0];
      const errorNote = firstError
        ? `；第 ${firstError.row} 行：${firstError.message}`
        : "";

      options.reset();
      setMessage(
        `${options.label}导入完成：新增 ${created}，更新 ${updated}，跳过 ${skipped}${errorNote}`,
      );
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入失败");
    } finally {
      setImporting(false);
    }
  }

  async function copyImportCredential() {
    setCopying(true);
    setCredentialStatus(null);
    try {
      const response = await fetch("/api/rankings/credential", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("需要登录后才能获取导入密钥");
      const payload = (await response.json()) as { secret: string };
      setCredential(payload.secret);
      await navigator.clipboard.writeText(payload.secret);
      setCredentialStatus("已复制");
    } catch (error) {
      setCredentialStatus(error instanceof Error ? error.message : "复制失败");
    } finally {
      setCopying(false);
    }
  }

  async function importJson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!jsonFile && !jsonText.trim()) return;
    setImporting(true); setMessage(null); setImportReceipts([]);
    try {
      if ((jsonFile?.size ?? new TextEncoder().encode(jsonText).length) > 4_000_000) throw new Error("文件不能超过 4 MB");
      const parsed = JSON.parse(jsonFile ? await jsonFile.text() : jsonText);
      const batches = parsed.batches ?? [parsed];
      if (!Array.isArray(batches) || !batches.length || batches.length > 300) throw new Error("文件需要包含 1–300 个批次");
      if (batches.some((batch: { targetDomain: string }) => !["flatkey.ai", "rackrate.org", "modelfit.cc"].includes(batch.targetDomain))) throw new Error("文件包含尚未启用的网站");
      let total = 0;
      let duplicateBatches = 0;
      const sourceCounts = { changed: 0, skipped: 0, added: 0, promoted: 0, held: 0, blocked: 0, conflicts: 0 };
      let sourceBatches = 0, previewBatches = 0;
      const pageCounts = { changed: 0, unchanged: 0, verified: 0, missing: 0, mismatch: 0, review: 0, noMatch: 0, contentGap: 0 };
      let pageBatches = 0, pagePreviews = 0;
      for (let index = 0; index < batches.length; index++) {
        setImportProgress(`正在导入 ${index + 1} / ${batches.length}`);
        try {
          const result = await postImportBatch(batches[index], {onRetry:attempt=>setImportProgress(`第 ${index+1} / ${batches.length} 批连接异常，正在原样重试 ${attempt} / 2`)});
          setImportReceipts(previous => [...previous, result]);
          total += result.imported;
          if (result.duplicate) duplicateBatches++;
          if (result.sourceSummary) {
            sourceBatches++; if (result.action === "preview") previewBatches++;
            const s = result.sourceSummary;
            sourceCounts.changed += s.changedRows; sourceCounts.skipped += s.unchangedRows;
            sourceCounts.added += s.newKeywords; sourceCounts.promoted += s.promotedFormal;
            sourceCounts.held += s.heldResearch; sourceCounts.blocked += s.blocked; sourceCounts.conflicts += s.conflicts;
          }
          if (result.pageSummary) {
            pageBatches++; if (result.action === "preview") pagePreviews++;
            for (const key of Object.keys(pageCounts) as Array<keyof typeof pageCounts>) pageCounts[key] += result.pageSummary[key];
          }
        } catch(error) {
          throw new Error(`第 ${index+1} 批未确认：${error instanceof Error ? error.message : "请重试"}。此前成功批次已保留，可重传同一文件。`);
        }
      }
      const summaries: string[] = [];
      if (sourceBatches) summaries.push(`协作表${previewBatches === sourceBatches ? "预览完成（未写入）" : "同步完成"}：变化 ${sourceCounts.changed} 行，未变化跳过 ${sourceCounts.skipped} 行；新增词 ${sourceCounts.added}，进入正式监控 ${sourceCounts.promoted}，保留候选 ${sourceCounts.held}；保护拦截 ${sourceCounts.blocked}，页面关联待核实 ${sourceCounts.conflicts}。`);
      if (pageBatches) summaries.push(`页面复核${pagePreviews === pageBatches ? "预览完成（未写入）" : "完成"}：匹配 ${pageCounts.verified}，待建设 ${pageCounts.missing + pageCounts.noMatch}，需补内容 ${pageCounts.contentGap}，错配 ${pageCounts.mismatch}，待核实 ${pageCounts.review}；变化 ${pageCounts.changed}，未变化 ${pageCounts.unchanged}。关键词保留。`);
      setMessage(summaries.length ? summaries.join("\n") : `导入完成：${batches.length} 批，共确认 ${total} 条记录；新增批次 ${batches.length-duplicateBatches}，重复跳过 ${duplicateBatches}（未重复写入）`);
      setJsonFile(null); setJsonText("");
      await loadDashboard();
    } catch (error) { setMessage(error instanceof Error ? error.message : "导入失败"); }
    finally { setImporting(false); setImportProgress(""); }
  }

  return (
    <main className="appShell">
      <PageHeader active="manage" selection={selection} />
      <div className="managementIntro">
        <div>
          <p className="eyebrow">WORKSPACE</p>
          <h1>数据管理</h1>
          <p>配置排名更新，管理词库与协作表同步。</p>
        </div>
        <div className="workspaceCounts">
          <span>
            <Layers3 size={15} />
            {data?.topics.length ?? "—"} 个话题
          </span>
          <span>
            <FileSpreadsheet size={15} />
            {data?.keywords.length ?? "—"} 个关键词
          </span>
        </div>
      </div>
      {message ? (
        <div className="notice" role="status">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="loadError" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void loadDashboard()}>
            重新加载
          </button>
        </div>
      ) : null}
      <DataforSeoConnection onChanged={loadDashboard} />
      <section className="manageWorkspace">
        <form className="topicEditor" onSubmit={submitTopic}>
          <div className="manageCardHeading">
            <span className="manageCardIcon">
              <Layers3 size={19} />
            </span>
            <div>
              <h2>新增话题</h2>
              <p>用话题归类关键词与内容方向</p>
            </div>
          </div>
          <label className="manageField">
            <span>话题名称</span>
            <input
              required
              placeholder="例如：GPU 租赁价格"
              value={topicForm.text}
              onChange={(event) =>
                setTopicForm((current) => ({
                  ...current,
                  text: event.target.value,
                }))
              }
            />
          </label>
          <fieldset className="topicTypeField">
            <legend>话题类型</legend>
            <div>
              {(["MAIN", "SUB_TOPIC"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={topicForm.type === type}
                  className={topicForm.type === type ? "selected" : ""}
                  onClick={() =>
                    setTopicForm((current) => ({ ...current, type }))
                  }
                >
                  {type === "MAIN" ? "主话题" : "子话题"}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="manageField">
            <span>父话题</span>
            <select
              disabled={topicForm.type === "MAIN" || mainTopics.length === 0}
              value={topicForm.parentId}
              onChange={(event) =>
                setTopicForm((current) => ({
                  ...current,
                  parentId: event.target.value,
                }))
              }
            >
              <option value="">
                {topicForm.type === "MAIN"
                  ? "主话题无需设置父级"
                  : "选择父话题"}
              </option>
              {mainTopics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.text}
                </option>
              ))}
            </select>
          </label>
          <button
            className="managePrimary"
            disabled={submitting || !topicForm.text.trim()}
            type="submit"
          >
            {submitting ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <Plus size={16} />
            )}
            新增话题
          </button>
        </form>
        <div className="batchImportPanel">
          <div className="batchImportHeading">
            <div>
              <h2>批量导入</h2>
              <p>先导入话题，再导入关键词。已有记录会按名称匹配。</p>
            </div>
            <span className="fileTypeTag">CSV</span>
          </div>
          <div className="uploadCards">
            <CsvUpload
              kind="话题"
              file={topicImportFile}
              inputKey={topicFileInputKey}
              onChange={setTopicImportFile}
              onError={setMessage}
              busy={importing}
              template="/api/topics/import/template"
              description="主话题、子话题和父级关系"
              onSubmit={(event) =>
                importCsv(event, {
                  file: topicImportFile,
                  endpoint: "/api/topics/import",
                  label: "话题",
                  reset: () => {
                    setTopicImportFile(null);
                    setTopicFileInputKey((current) => current + 1);
                  },
                })
              }
            />
            <CsvUpload
              kind="关键词"
              file={keywordImportFile}
              inputKey={keywordFileInputKey}
              onChange={setKeywordImportFile}
              onError={setMessage}
              busy={importing}
              template="/api/keywords/import/template"
              description="关键词、所属话题与地区声量"
              onSubmit={(event) =>
                importCsv(event, {
                  file: keywordImportFile,
                  endpoint: "/api/keywords/import",
                  label: "关键词",
                  reset: () => {
                    setKeywordImportFile(null);
                    setKeywordFileInputKey((current) => current + 1);
                  },
                })
              }
            />
          </div>
        </div>
      </section>
      <form className="jsonImportPanel" onSubmit={importJson}>
        <div><h2>采集结果与周报导入</h2><a className="textLink" href="/api/seo/worklist">下载每日采集清单</a><p>支持三张协作表增量同步、页面复核、排名证据和 GA4 周报；未变化记录跳过，候选词持续保留。</p><p>周报：周二至周一 · 注册成功去重人数 · GA4 原报告时区</p></div>
        <label className="jsonFile"><span>选择 JSON 文件</span><input type="file" aria-label="选择采集或周报 JSON 文件" accept=".json,application/json" disabled={importing} onChange={(e) => setJsonFile(e.target.files?.[0] ?? null)} />{jsonFile?.name}</label>
        <details className="jsonPaste"><summary>或粘贴 JSON 数据</summary><textarea aria-label="粘贴采集 JSON 数据" placeholder="粘贴单个批次或 batches 文件内容" value={jsonText} disabled={importing} onChange={(event) => { setJsonText(event.target.value); setJsonFile(null); }} /></details>
        <button className="managePrimary" disabled={(!jsonFile && !jsonText.trim()) || importing}>{importProgress || "导入数据"}</button>
        {importReceipts.length ? <details className="jsonPaste"><summary>查看本次导入回执（{importReceipts.length} 批）</summary><textarea aria-label="导入确认回执" readOnly value={JSON.stringify({ results: importReceipts }, null, 2)} /></details> : null}
      </form>
      <KeywordReviewPanel />
      <section className="collectorConnection">
        <div className="collectorInfo">
          <span className="manageCardIcon">
            <Clock3 size={19} />
          </span>
          <div>
            <h2>协作表与历史证据导入</h2>
            <p>现有词库 + 三张协作表增量；保留候选与原始证据</p>
            <span className="lastImport">
              最后导入：
              {data?.latestImportAt
                ? new Date(data.latestImportAt).toLocaleString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                  })
                : "等待首次采集"}
            </span>
          </div>
        </div>
        <div className="collectorCredentials">
          <label htmlFor="import-credential">导入密钥</label>
          <div>
            <input
              id="import-credential"
              aria-label="导入密钥"
              type="password"
              readOnly
              value={credential ?? ""}
              placeholder="点击复制获取密钥"
              autoComplete="off"
            />
            <button
              type="button"
              disabled={copying}
              onClick={copyImportCredential}
            >
              {copying ? (
                <Loader2 className="spin" size={15} />
              ) : credentialStatus === "已复制" ? (
                <Check size={15} />
              ) : (
                <Copy size={15} />
              )}
              {credentialStatus === "已复制" ? "已复制" : "复制密钥"}
            </button>
          </div>
          <span className="credentialFeedback" role="status">
            {credentialStatus && credentialStatus !== "已复制"
              ? credentialStatus
              : "POST /api/rankings/import"}
          </span>
        </div>
      </section>
    </main>
  );
}

function CsvUpload({
  kind,
  file,
  inputKey,
  onChange,
  onError,
  busy,
  template,
  description,
  onSubmit,
}: {
  kind: string;
  file: File | null;
  inputKey: number;
  onChange: (file: File | null) => void;
  onError: (message: string) => void;
  busy: boolean;
  template: string;
  description: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const selectFile = (selected: File | null) => {
    if (selected && !selected.name.toLowerCase().endsWith(".csv")) {
      onError("请选择 CSV 文件");
      return;
    }
    if (selected && selected.size > 1_000_000) {
      onError("CSV 文件不能超过 1 MB");
      return;
    }
    onChange(selected);
  };
  return (
    <form className="csvUploadCard" onSubmit={onSubmit}>
      <div className="formTitleRow">
        <h3>{kind}导入</h3>
        <a
          className="templateTextLink"
          download
          href={template}
          title={`下载${kind} CSV 模板`}
        >
          <Download size={14} />
          下载模板
        </a>
      </div>
      <p>{description}</p>
      <label
        className={file ? "uploadDropzone hasFile" : "uploadDropzone"}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          selectFile(event.dataTransfer.files[0] ?? null);
        }}
      >
        <input
          key={inputKey}
          aria-label={`选择${kind} CSV`}
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
        />
        <FileSpreadsheet size={24} />
        <strong>{file ? file.name : "点击选择或拖入文件"}</strong>
        <span>
          {file
            ? `${(file.size / 1024).toFixed(1)} KB · 点击替换`
            : "仅支持 CSV，最大 1 MB"}
        </span>
      </label>
      <button className="uploadSubmit" type="submit" disabled={busy || !file}>
        {busy ? <Loader2 className="spin" size={15} /> : <Upload size={15} />}
        导入{kind}
      </button>
    </form>
  );
}
