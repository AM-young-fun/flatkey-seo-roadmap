"use client";

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
  KeywordType,
  RankSummary,
  SyncRunSummary
} from "@/lib/types";
import {
  rankDeltaLabel,
  rankLabel,
  RANK_BUCKET_META,
  REGION_CODES,
  REGIONS,
  type SearchRegionCode
} from "@/lib/seo";

const initialForm = {
  text: "",
  type: "MAIN" as KeywordType,
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

function parentName(keyword: DashboardKeyword, keywords: DashboardKeyword[]): string {
  const parentIds = keyword.parentIds.length > 0 ? keyword.parentIds : keyword.parentId ? [keyword.parentId] : [];

  if (parentIds.length === 0) {
    return "-";
  }

  return parentIds
    .map((parentId) => keywords.find((item) => item.id === parentId)?.text)
    .filter((text): text is string => Boolean(text))
    .join(" / ") || "-";
}

function bucketClass(bucket: string | undefined, pending = false): string {
  return `rankBadge rankBadge_${bucket ?? "NOT_FOUND"}${pending ? " rankBadge_pending" : ""}`;
}

function marketVolume(keyword: DashboardKeyword, region: SearchRegionCode): number {
  return keyword.marketVolumes[region] ?? keyword.latestRanks[region]?.searchVolume ?? 0;
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
  const [form, setForm] = useState(initialForm);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);

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

  const mainKeywords = useMemo(
    () => data?.keywords.filter((keyword) => keyword.type === "MAIN") ?? [],
    [data]
  );

  const stats = useMemo(() => {
    const keywords = data?.keywords ?? [];
    const ranks = keywords.map((keyword) => keyword.latestRanks[selectedRegion]).filter(Boolean);
    const top5 = ranks.filter((rank) => rank?.bucket === "TOP_5").length;
    const changed = ranks.filter((rank) => rank?.changed).length;
    const totalVolume = keywords.reduce((sum, keyword) => {
      return sum + marketVolume(keyword, selectedRegion);
    }, 0);

    return {
      keywords: keywords.length,
      top5,
      changed,
      totalVolume
    };
  }, [data, selectedRegion]);

  async function submitKeyword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch("/api/keywords", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: form.text,
          type: form.type,
          parentId: form.type === "LONG_TAIL" ? form.parentId || null : null
        })
      });

      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        created?: boolean;
      };

      if (!response.ok) {
        throw new Error(payload.message ?? "新增失败");
      }

      setForm(initialForm);
      setMessage(payload.created === false ? "关键词已更新" : "关键词已新增");
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "新增失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function importKeywords(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!importFile) {
      setMessage("请选择 CSV 文件");
      return;
    }

    setImporting(true);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", importFile);

      const response = await fetch("/api/keywords/import", {
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

      setImportFile(null);
      setFileInputKey((current) => current + 1);
      setMessage(`导入完成：新增 ${created}，更新 ${updated}，跳过 ${skipped}${errorNote}`);
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
          <span>关键词</span>
          <strong>{loading ? "-" : stats.keywords}</strong>
        </div>
        <div className="metricPanel">
          <BarChart3 size={18} />
          <span>前 5</span>
          <strong>{loading ? "-" : stats.top5}</strong>
        </div>
        <div className="metricPanel">
          <GitCompareArrows size={18} />
          <span>今日 Diff</span>
          <strong>{loading ? "-" : stats.changed}</strong>
        </div>
        <div className="metricPanel">
          <Activity size={18} />
          <span>声量</span>
          <strong>{loading ? "-" : stats.totalVolume.toLocaleString()}</strong>
        </div>
      </section>

      <section className="workbench">
        <div className="graphPanel">
          <div className="panelHeader">
            <div>
              <h2>关键词关系图</h2>
              <p>{REGIONS[selectedRegion].label}</p>
            </div>
            <div className="legend">
              {Object.entries(RANK_BUCKET_META).map(([bucket, meta]) => (
                <span key={bucket}>
                  <i style={{ background: meta.color }} />
                  {meta.label}
                </span>
              ))}
            </div>
          </div>
          {loading || !data ? (
            <div className="loadingState">
              <Loader2 className="spin" size={18} />
              加载中
            </div>
          ) : (
            <KeywordGraph keywords={data.keywords} selectedRegion={selectedRegion} />
          )}
        </div>

        <aside className="sidePanel">
          <form className="keywordForm" onSubmit={submitKeyword}>
            <h2>新增关键词</h2>
            <label>
              <span>关键词</span>
              <input
                onChange={(event) => setForm((current) => ({ ...current, text: event.target.value }))}
                placeholder="输入关键词"
                required
                value={form.text}
              />
            </label>
            <label>
              <span>类型</span>
              <select
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    type: event.target.value as KeywordType
                  }))
                }
                value={form.type}
              >
                <option value="MAIN">主关键词</option>
                <option value="LONG_TAIL">长尾关键词</option>
              </select>
            </label>
            <label>
              <span>父级</span>
              <select
                disabled={form.type === "MAIN" || mainKeywords.length === 0}
                onChange={(event) =>
                  setForm((current) => ({ ...current, parentId: event.target.value }))
                }
                value={form.parentId}
              >
                <option value="">无</option>
                {mainKeywords.map((keyword) => (
                  <option key={keyword.id} value={keyword.id}>
                    {keyword.text}
                  </option>
                ))}
              </select>
            </label>
            <button className="secondaryButton" disabled={submitting} type="submit">
              {submitting ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
              新增
            </button>
          </form>

          <form className="importForm" onSubmit={importKeywords}>
            <div className="formTitleRow">
              <h2>CSV 导入</h2>
              <a
                className="downloadTemplateLink"
                download
                href="/api/keywords/import/template"
                title="下载 CSV 模板"
              >
                <Download size={15} />
                模板
              </a>
            </div>
            <label>
              <span>CSV 文件</span>
              <input
                accept=".csv,text/csv"
                key={fileInputKey}
                onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
                type="file"
              />
            </label>
            <button className="secondaryButton" disabled={importing || !importFile} type="submit">
              {importing ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}
              导入 CSV
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
            <h2>排名明细</h2>
            <p>{data?.targetDomain ?? "未设置目标域名"}</p>
          </div>
        </div>
        <div className="tableScroll">
          <table>
            <thead>
              <tr>
                <th>关键词</th>
                <th>类型</th>
                <th>父级</th>
                <th>声量（{REGIONS[selectedRegion].label}）</th>
                <th>同步时间</th>
                {REGION_CODES.map((region) => (
                  <th key={region}>{REGIONS[region].label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.keywords ?? []).map((keyword) => (
                <tr key={keyword.id}>
                  <td>
                    <strong>{keyword.text}</strong>
                  </td>
                  <td>{keyword.type === "MAIN" ? "主关键词" : "长尾关键词"}</td>
                  <td>{parentName(keyword, data?.keywords ?? [])}</td>
                  <td>{marketVolume(keyword, selectedRegion).toLocaleString()}</td>
                  <td>{formatDate(keyword.lastSyncedAt)}</td>
                  {REGION_CODES.map((region) => {
                    const rank = keyword.latestRanks[region];
                    return (
                      <td key={region}>
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
                      </td>
                    );
                  })}
                </tr>
              ))}
              {!loading && data?.keywords.length === 0 ? (
                <tr>
                  <td colSpan={REGION_CODES.length + 5}>暂无关键词</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
