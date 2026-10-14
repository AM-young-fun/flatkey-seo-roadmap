"use client";
import { FormEvent, useState } from "react";
import { Download, Loader2, Plus, Upload } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useDashboard } from "@/components/useDashboard";
import type { TopicType } from "@/lib/types";
const initialTopicForm = { text: "", type: "MAIN" as TopicType, parentId: "" };
type ImportKeywordsResponse = {
  message?: string;
  created?: number;
  updated?: number;
  skipped?: number;
  errors?: Array<{ row: number; message: string }>;
};
export function ManagementDashboard() {
  const { data, refresh: loadDashboard, error } = useDashboard();
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
    try {
      const response = await fetch("/api/rankings/credential", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("需要登录后才能获取导入密钥");
      const payload = (await response.json()) as { secret: string };
      await navigator.clipboard.writeText(payload.secret);
      setMessage("导入密钥已复制，请保存到每日采集任务的本地配置中");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "复制失败");
    }
  }

  return (
    <main className="appShell">
      <PageHeader active="manage" />
      <div className="pageIntro">
        <p className="eyebrow">WORKSPACE</p>
        <h1>数据管理</h1>
        <p>维护话题与关键词，接收每日采集结果。</p>
      </div>
      {message || error ? (
        <div className="notice" role="status">
          {message || error}
        </div>
      ) : null}
      <section className="managementGrid">
        {" "}
        <form className="keywordForm" onSubmit={submitTopic}>
          <h2>新增话题</h2>
          <label>
            <span>话题</span>
            <input
              onChange={(event) =>
                setTopicForm((current) => ({
                  ...current,
                  text: event.target.value,
                }))
              }
              placeholder="输入话题"
              required
              value={topicForm.text}
            />
          </label>
          <label>
            <span>类型</span>
            <select
              onChange={(event) =>
                setTopicForm((current) => ({
                  ...current,
                  type: event.target.value as TopicType,
                }))
              }
              value={topicForm.type}
            >
              <option value="MAIN">主话题</option>
              <option value="SUB_TOPIC">子话题</option>
            </select>
          </label>
          <label>
            <span>父级</span>
            <select
              disabled={topicForm.type === "MAIN" || mainTopics.length === 0}
              onChange={(event) =>
                setTopicForm((current) => ({
                  ...current,
                  parentId: event.target.value,
                }))
              }
              value={topicForm.parentId}
            >
              <option value="">无</option>
              {mainTopics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.text}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondaryButton"
            disabled={submitting}
            type="submit"
          >
            {submitting ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <Plus size={16} />
            )}
            新增
          </button>
        </form>
        <form
          className="importForm"
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
        >
          <div className="formTitleRow">
            <h2>话题 CSV</h2>
            <a
              className="downloadTemplateLink"
              download
              href="/api/topics/import/template"
              title="下载话题 CSV 模板"
            >
              <Download size={15} />
              模板
            </a>
          </div>
          <label>
            <span>CSV 文件</span>
            <input
              accept=".csv,text/csv"
              key={topicFileInputKey}
              onChange={(event) =>
                setTopicImportFile(event.target.files?.[0] ?? null)
              }
              type="file"
            />
          </label>
          <button
            className="secondaryButton"
            disabled={importing || !topicImportFile}
            type="submit"
          >
            {importing ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <Upload size={16} />
            )}
            导入话题
          </button>
        </form>
        <form
          className="importForm"
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
        >
          <div className="formTitleRow">
            <h2>关键词 CSV</h2>
            <a
              className="downloadTemplateLink"
              download
              href="/api/keywords/import/template"
              title="下载关键词 CSV 模板"
            >
              <Download size={15} />
              模板
            </a>
          </div>
          <label>
            <span>CSV 文件</span>
            <input
              accept=".csv,text/csv"
              key={keywordFileInputKey}
              onChange={(event) =>
                setKeywordImportFile(event.target.files?.[0] ?? null)
              }
              type="file"
            />
          </label>
          <button
            className="secondaryButton"
            disabled={importing || !keywordImportFile}
            type="submit"
          >
            {importing ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <Upload size={16} />
            )}
            导入关键词
          </button>
        </form>
        <div className="importForm">
          <h2>定时任务导入</h2>
          <p className="muted">
            每日
            10:30（北京时间）采集完成后，任务通过受密钥保护的接口上传结果。支持
            GSC 平均排名和 Ahrefs 排名、声量。
          </p>
          <code>POST /api/rankings/import</code>
          <button
            type="button"
            className="secondaryButton"
            onClick={copyImportCredential}
          >
            复制导入密钥
          </button>
          <p className="muted">
            最后导入：
            {data?.latestImportAt
              ? new Date(data.latestImportAt).toLocaleString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                })
              : "暂无导入记录"}
          </p>
        </div>
      </section>
    </main>
  );
}
