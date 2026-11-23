/** Client continuation for the user's exact one-off approval. A page read never starts it. */
export type ApprovedOtherKeywordReviewView = {
  quoteId: string;
  runId: string;
  scope: "APPROVED_OTHER_KEYWORD_REVIEW";
  approved: boolean;
  queryCount: number;
  maxCostMicros: number;
  quoteSha256: string;
  totalKeywordCount: number;
  reuseCount: number;
  combinedMaxCostMicros: number;
  combinedApprovedCapMicros: number;
  gate: { firstRunComplete: boolean; reason: string | null };
  run: null | {
    status: string;
    completedAt: string | null;
    startedAt: string | null;
    actualCostMicros: number | null;
    taskCounts: Record<string, number>;
    errorCode: string | null;
  };
  countries: {
    country: string; language: string; queryCount: number; completeCount: number; reuseCount: number;
    rankedCount: number | null; actualCostMicros: number | null;
  }[];
  items: {
    keywordId: string; keyword: string; country: string; language: string; state: string;
    checkedAt: string | null; costMicros: number | null; ranked: boolean | null; rank: number | null;
    pages: { url: string; rank: number }[]; originalTargetUrls: string[]; reused: boolean;
    gap: string | null; sourceRunId: string | null; previousCostMicros?: number | null;
  }[];
};

export type ApprovedOtherKeywordReviewCommand = {
  action: "prepare" | "resume" | "collect";
  quoteSha256: string;
  maxCostMicros: number;
};
const quoteSha256 = "594de337ece1521c6ff32c2fa9ab22948a0f3531dd96ce7f81bd9e0f11a271ef";
const cap = 2_802_000;
const terminal = new Set(["COMPLETED", "PARTIAL", "FAILED", "UNKNOWN", "PAUSED"]);

function assertApprovedView(view: ApprovedOtherKeywordReviewView) {
  if (!view || view.quoteId !== "other-country-query-proposal-v2" ||
    view.runId !== "approved-other-keyword-review-20261123-v1" || view.scope !== "APPROVED_OTHER_KEYWORD_REVIEW" ||
    view.approved !== true || view.queryCount !== 467 || view.maxCostMicros !== cap ||
    view.quoteSha256 !== quoteSha256 || view.totalKeywordCount !== 468 || view.reuseCount !== 1 ||
    view.combinedMaxCostMicros !== 8_988_000 || view.combinedApprovedCapMicros !== 8_994_000) {
    throw new Error("采集清单或费用上限与本次批准不一致，已停止后续提交。");
  }
  if (!view.run) return;
  const counts = Object.values(view.run.taskCounts ?? {});
  if (!counts.length || counts.some(value => !Number.isSafeInteger(value) || value < 0) ||
    counts.reduce((sum, value) => sum + value, 0) !== 467 ||
    !["PLANNED", "RUNNING", ...terminal].includes(view.run.status)) {
    throw new Error("采集回执不完整，已停止后续提交，请核对原批次。");
  }
  const cost = view.run.actualCostMicros;
  if (cost !== null && (!Number.isSafeInteger(cost) || cost < 0 || cost > cap)) {
    throw new Error("费用回执超出本批上限或尚需核对，已停止后续提交。");
  }
}

export async function continueApprovedOtherKeywordReview(options: {
  read: () => Promise<ApprovedOtherKeywordReviewView>;
  post: (command: ApprovedOtherKeywordReviewCommand) => Promise<ApprovedOtherKeywordReviewView>;
  stopped: () => boolean;
  progress: (view: ApprovedOtherKeywordReviewView) => void;
  wait?: (milliseconds: number) => Promise<void>;
}): Promise<"finished" | "stopped" | "needs_review"> {
  if (options.stopped()) return "stopped";
  const wait = options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  try {
    let view = await options.read();
    assertApprovedView(view);
    options.progress(view);
    if (options.stopped()) return "stopped";
    if (!view.run) {
      if (!view.gate?.firstRunComplete) throw new Error(view.gate?.reason || "请等待首批1031词采集完成后，再执行补采。");
      view = await options.post({ action: "prepare", quoteSha256, maxCostMicros: cap });
      assertApprovedView(view);
      options.progress(view);
      if (!view.run) throw new Error("本批账本建立回执未确认，已停止后续提交。");
    }
    for (;;) {
      if (options.stopped()) return "stopped";
      assertApprovedView(view);
      const run = view.run!;
      if (run.errorCode || (run.taskCounts.UNKNOWN ?? 0) > 0 || (run.taskCounts.FAILED ?? 0) > 0) {
        return "needs_review";
      }
      if (terminal.has(run.status)) return run.status === "COMPLETED" ? "finished" : "needs_review";
      const action = (run.taskCounts.PLANNED ?? 0) > 0 ? "resume" : "collect";
      if (action === "resume" && !view.gate?.firstRunComplete) {
        throw new Error(view.gate?.reason || "首批采集尚未完成，已停止后续补采提交。");
      }
      // One serial batch only. Never retry an ambiguous POST or abandon its receipt mid-flight.
      view = await options.post({ action, quoteSha256, maxCostMicros: cap });
      assertApprovedView(view);
      options.progress(view);
      if (options.stopped()) return "stopped";
      const next = view.run;
      if (!next) throw new Error("原批次回执丢失，已停止后续提交。");
      if (next.errorCode || (next.taskCounts.UNKNOWN ?? 0) > 0 || (next.taskCounts.FAILED ?? 0) > 0) return "needs_review";
      if (terminal.has(next.status)) return next.status === "COMPLETED" ? "finished" : "needs_review";
      await wait(3000);
    }
  } catch (cause) {
    // A GET is safe even if the preceding response was lost; it does not retry the paid command.
    try {
      const saved = await options.read();
      assertApprovedView(saved);
      options.progress(saved);
    } catch { /* Preserve the original ambiguous failure. */ }
    const message = cause instanceof Error ? cause.message : "采集请求结果尚待核对";
    throw new Error(`${message} 后续提交已停止；请查看原批次回执，未自动重试。`);
  }
}
