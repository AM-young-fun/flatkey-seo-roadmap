"use client";

import { Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  Activity,
  BarChart3,
  Database,
  Download,
  GitCompareArrows,
  Loader2,
  LogOut,
  MapPin,
  Plus,
  RefreshCcw,
  Upload
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { KeywordGraph } from "@/components/KeywordGraph";
import type {
  DashboardKeyword,
  DashboardResponse,
  RankSummary,
  SyncRunSummary,
  TopicType
} from "@/lib/types";
import {
  rankDeltaLabel,
  rankLabel,
  REGION_CODES,
  REGIONS,
  type SearchRegionCode
} from "@/lib/seo";

const initialTopicForm = {
  text: "",
  type: "MAIN" as TopicType,
  parentId: ""
};

type ImportKeywordsResponse = {
  message?: string;
  created?: number;
  updated?: number;
  skipped?: number;
  errors?: Array<{
    row: number;
    message: string;
  }>;
};

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function bucketClass(bucket: string | undefined, pending = false): string {
  return `rankBadge rankBadge_${bucket ?? "NOT_FOUND"}${pending ? " rankBadge_pending" : ""}`;
}

function marketVolume(keyword: DashboardKeyword, region: SearchRegionCode): number {
  return keyword.marketVolumes[region] ?? keyword.latestRanks[region]?.searchVolume ?? 0;
}

function usVolume(keyword: DashboardKeyword): number {
  return marketVolume(keyword, "US");
}

function rankStatusLabel(rank: RankSummary | null | undefined): string {
  return rank ? rankLabel(rank.rank) : "未同步";
}

function syncProgressText(summary: SyncRunSummary | null | undefined): string {
  const processed = summary?.processed ?? 0;
  const total = summary?.totalChecks ?? 0;

  if (!total) {
    return "-";
  }

  return `${processed.toLocaleString()} / ${total.toLocaleString()}`;
}

function currentSyncText(summary: SyncRunSummary | null | undefined): string {
  if (!summary?.currentKeyword) {
    return "-";
  }

  const region = summary.currentRegion ? REGIONS[summary.currentRegion].label : "-";
  return `${summary.currentKeyword} · ${region}`;
}

export function Dashboard() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<SearchRegionCode>("US");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [topicForm, setTopicForm] = useState(initialTopicForm);
  const [topicImportFile, setTopicImportFile] = useState<File | null>(null);
  const [keywordImportFile, setKeywordImportFile] = useState<File | null>(null);
  const [topicFileInputKey, setTopicFileInputKey] = useState(0);
  const [keywordFileInputKey, setKeywordFileInputKey] = useState(0);

  const loadDashboard = useCallback(async () => {
    const response = await fetch("/api/dashboard", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("Dashboard request failed");
    }

    setData((await response.json()) as DashboardResponse);
  }, []);

  const latestRun = data?.latestRun ?? null;
  const persistedSyncing = latestRun?.status === "RUNNING";
  const syncInProgress = syncing || persistedSyncing;

  useEffect(() => {
    loadDashboard()
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : "加载失败");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [loadDashboard]);

  useEffect(() => {
    if (!syncInProgress) {
      return;
    }

    const intervalId = window.setInterval(() => {
      loadDashboard().catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : "同步状态刷新失败");
      });
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadDashboard, syncInProgress]);

  const mainTopics = useMemo(
    () => data?.topics.filter((topic) => topic.type === "MAIN") ?? [],
    [data]
  );

  const stats = useMemo(() => {
    const topics = data?.topics ?? [];
    const keywords = data?.keywords ?? [];
    const ranks = keywords.map((keyword) => keyword.latestRanks[selectedRegion]).filter(Boolean);
    const top5 = ranks.filter((rank) => rank?.bucket === "TOP_5").length;
    const totalVolume = keywords.reduce((sum, keyword) => {
      return sum + marketVolume(keyword, selectedRegion);
    }, 0);

    return {
      topics: topics.length,
      keywords: keywords.length,
      top5,
      totalVolume
    };
  }, [data, selectedRegion]);

  async function submitTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch("/api/topics", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: topicForm.text,
          type: topicForm.type,
          parentId: topicForm.type === "SUB_TOPIC" ? topicForm.parentId || null : null
        })
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
    }
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
        body: formData
      });
      const payload = (await response.json().catch(() => ({}))) as ImportKeywordsResponse;

      if (!response.ok) {
        throw new Error(payload.message ?? "导入失败");
      }

      const created = payload.created ?? 0;
      const updated = payload.updated ?? 0;
      const skipped = payload.skipped ?? 0;
      const firstError = payload.errors?.[0];
      const errorNote = firstError ? `；第 ${firstError.row} 行：${firstError.message}` : "";

      options.reset();
      setMessage(`${options.label}导入完成：新增 ${created}，更新 ${updated}，跳过 ${skipped}${errorNote}`);
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入失败");
    } finally {
      setImporting(false);
    }
  }

  async function runSync() {
    setSyncing(true);
    setMessage(null);

    try {
      const response = await fetch("/api/sync/run", {
        method: "POST"
      });
      const payload = (await response.json().catch(() => ({}))) as {
        status?: string;
        summary?: {
          errors?: Array<{ message?: string }>;
          warnings?: Array<{ message?: string }>;
        };
      };

      if (!response.ok) {
        throw new Error("同步失败");
      }

      if (payload.status === "FAILED") {
        const firstError = payload.summary?.errors?.[0]?.message;
        throw new Error(firstError ? `同步失败：${firstError}` : "同步失败");
      }

      if (payload.status === "RUNNING") {
        setMessage("同步正在运行，进度已记录");
        await loadDashboard();
        return;
      }

      const errorCount = payload.summary?.errors?.length ?? 0;
      const warningCount = payload.summary?.warnings?.length ?? 0;
      setMessage(
        errorCount > 0
          ? `同步完成，${errorCount} 条错误`
          : warningCount > 0
            ? `同步完成，${warningCount} 条警告`
            : "同步完成"
      );
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "同步失败");
    } finally {
      setSyncing(false);
    }
  }

  const keywordColumns = useMemo<ColumnsType<DashboardKeyword>>(() => {
    const volumeColumns: ColumnsType<DashboardKeyword> = [
      {
        title: "美国声量",
        key: "usVolume",
        sorter: (a, b) => usVolume(a) - usVolume(b),
        defaultSortOrder: "descend",
        render: (_, keyword) => usVolume(keyword).toLocaleString()
      }
    ];

    if (selectedRegion !== "US") {
      volumeColumns.push({
        title: `${REGIONS[selectedRegion].label}声量`,
        key: "selectedMarketVolume",
        sorter: (a, b) => marketVolume(a, selectedRegion) - marketVolume(b, selectedRegion),
        render: (_, keyword) => marketVolume(keyword, selectedRegion).toLocaleString()
      });
    }

    return [
      {
        title: "关键词",
        dataIndex: "text",
        key: "text",
        sorter: (a, b) => a.text.localeCompare(b.text),
        render: (text: string) => <strong>{text}</strong>
      },
      {
        title: "所属话题",
        dataIndex: "topicText",
        key: "topicText",
        sorter: (a, b) => (a.topicText ?? "").localeCompare(b.topicText ?? ""),
        render: (text: string | null) => text ?? "-"
      },
      ...volumeColumns,
      {
        title: "同步时间",
        dataIndex: "lastSyncedAt",
        key: "lastSyncedAt",
        sorter: (a, b) =>
          new Date(a.lastSyncedAt ?? 0).getTime() - new Date(b.lastSyncedAt ?? 0).getTime(),
        render: (value: string | null) => formatDate(value)
      },
      ...REGION_CODES.map((region) => ({
        title: REGIONS[region].label,
        key: `rank-${region}`,
        render: (_: unknown, keyword: DashboardKeyword) => {
          const rank = keyword.latestRanks[region];

          return (
            <>
              <span className={bucketClass(rank?.bucket, !rank)}>
                <i />
                {rankStatusLabel(rank)}
              </span>
              <span
                className={
                  rank?.rankDelta && rank.rankDelta > 0
                    ? "delta up"
                    : rank?.rankDelta && rank.rankDelta < 0
                      ? "delta down"
                      : "delta"
                }
              >
                {rankDeltaLabel(rank?.rankDelta)}
              </span>
            </>
          );
        }
      }))
    ];
  }, [selectedRegion]);

  return (
    <main className="appShell">
      <header className="topBar">
        <div>
          <p className="eyebrow">SEO Rank Monitor</p>
          <h1>关键词排名监控</h1>
        </div>
        <div className="topActions">
          <div className="regionSwitch" aria-label="地区">
            {REGION_CODES.map((region) => (
              <button
                className={region === selectedRegion ? "regionButton active" : "regionButton"}
                key={region}
                onClick={() => setSelectedRegion(region)}
                type="button"
                title={REGIONS[region].googleLabel}
              >
                <MapPin size={14} />
                {REGIONS[region].label}
              </button>
            ))}
          </div>
          <button
            className="primaryButton"
            disabled={syncInProgress}
            onClick={runSync}
            title="立即同步"
            type="button"
          >
            {syncInProgress ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
            {syncInProgress ? "同步中" : "立即同步"}
          </button>
          <form action="/api/auth/logout" method="post">
            <button className="iconButton" title="退出登录" type="submit">
              <LogOut size={16} />
            </button>
          </form>
        </div>
      </header>

      {message ? <div className="notice">{message}</div> : null}

      <section className="metricGrid">
        <div className="metricPanel">
          <Database size={18} />
          <span>话题</span>
          <strong>{loading ? "-" : stats.topics}</strong>
        </div>
        <div className="metricPanel">
          <BarChart3 size={18} />
          <span>关键词</span>
          <strong>{loading ? "-" : stats.keywords}</strong>
        </div>
        <div className="metricPanel">
          <GitCompareArrows size={18} />
          <span>前 5</span>
          <strong>{loading ? "-" : stats.top5}</strong>
        </div>
        <div className="metricPanel">
          <Activity size={18} />
          <span>{REGIONS[selectedRegion].label}声量</span>
          <strong>{loading ? "-" : stats.totalVolume.toLocaleString()}</strong>
        </div>
      </section>

      <section className="workbench">
        <div className="graphPanel">
          <div className="panelHeader">
            <div>
              <h2>话题关系图</h2>
              <p>{REGIONS[selectedRegion].label}</p>
            </div>
            <div className="legend">
              <span>
                <i style={{ background: "#2563eb" }} />
                主话题
              </span>
              <span>
                <i style={{ background: "#0891b2" }} />
                子话题
              </span>
            </div>
          </div>
          {loading || !data ? (
            <div className="loadingState">
              <Loader2 className="spin" size={18} />
              加载中
            </div>
          ) : (
            <KeywordGraph topics={data.topics} selectedRegion={selectedRegion} />
          )}
        </div>

        <aside className="sidePanel">
          <form className="keywordForm" onSubmit={submitTopic}>
            <h2>新增话题</h2>
            <label>
              <span>话题</span>
              <input
                onChange={(event) =>
                  setTopicForm((current) => ({ ...current, text: event.target.value }))
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
                    type: event.target.value as TopicType
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
                  setTopicForm((current) => ({ ...current, parentId: event.target.value }))
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
            <button className="secondaryButton" disabled={submitting} type="submit">
              {submitting ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
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
                }
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
                onChange={(event) => setTopicImportFile(event.target.files?.[0] ?? null)}
                type="file"
              />
            </label>
            <button className="secondaryButton" disabled={importing || !topicImportFile} type="submit">
              {importing ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}
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
                }
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
                onChange={(event) => setKeywordImportFile(event.target.files?.[0] ?? null)}
                type="file"
              />
            </label>
            <button className="secondaryButton" disabled={importing || !keywordImportFile} type="submit">
              {importing ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}
              导入关键词
            </button>
          </form>

          <div className="runPanel">
            <h2>最新运行</h2>
            <dl>
              <div>
                <dt>状态</dt>
                <dd>{latestRun?.status ?? "-"}</dd>
              </div>
              <div>
                <dt>Provider</dt>
                <dd>{latestRun?.provider ?? "-"}</dd>
              </div>
              <div>
                <dt>进度</dt>
                <dd>{syncProgressText(latestRun?.summary)}</dd>
              </div>
              {latestRun?.status === "RUNNING" ? (
                <div>
                  <dt>当前</dt>
                  <dd>{currentSyncText(latestRun.summary)}</dd>
                </div>
              ) : null}
              <div>
                <dt>更新时间</dt>
                <dd>{formatDate(latestRun?.summary?.updatedAt)}</dd>
              </div>
              <div>
                <dt>完成时间</dt>
                <dd>{formatDate(latestRun?.finishedAt)}</dd>
              </div>
              <div>
                <dt>数据</dt>
                <dd>{data?.usingDemoData ? "Demo" : "PostgreSQL"}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </section>

      <section className="tablePanel">
        <div className="panelHeader">
          <div>
            <h2>关键词明细</h2>
            <p>{data?.targetDomain ?? "未设置目标域名"}</p>
          </div>
        </div>
        <Table
          className="keywordTable"
          columns={keywordColumns}
          dataSource={data?.keywords ?? []}
          loading={loading}
          pagination={{
            defaultPageSize: 50,
            showSizeChanger: true
          }}
          rowKey="id"
          scroll={{ x: 1180 }}
          size="middle"
        />
      </section>
    </main>
  );
}
