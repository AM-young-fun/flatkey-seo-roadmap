import { z } from "zod";
import { createHash } from "node:crypto";

export const PROMPT_REPOSITORIES = ["flatkey-ai/awesome-images", "flatkey-ai/awesome-seedance-prompts"] as const;
const metric = z.number().int().nonnegative();
const day = z.object({ date: z.iso.date(), count: metric, uniques: metric }).strict();
const traffic = z.object({ status: z.enum(["ok", "unavailable"]), count: metric.nullable(), uniques: metric.nullable(), days: z.array(day).max(16), reason: z.string().max(300).nullable() }).strict().superRefine((v, ctx) => {
  if (new Set(v.days.map(d => d.date)).size !== v.days.length || v.days.some(d => d.uniques > d.count)) ctx.addIssue({ code: "custom", message: "流量日期或去重人数无效" });
  if (v.status === "unavailable" && (v.count !== null || v.uniques !== null || v.days.length)) ctx.addIssue({ code: "custom", message: "缺失流量不能填零" });
  if (v.status === "ok" && (v.count === null || v.uniques === null || v.uniques > v.count || v.count !== v.days.reduce((n, d) => n + d.count, 0))) ctx.addIssue({ code: "custom", message: "GitHub流量与逐日明细不一致" });
});
export const githubReferralSchema = z.object({ start: z.iso.date(), end: z.iso.date(), timezone: z.literal("America/Los_Angeles"), status: z.enum(["ok", "partial", "unavailable"]), sessions: metric.nullable(), users: metric.nullable(), observedAt: z.iso.datetime({ offset: true }), reason: z.string().max(300).nullable() }).strict().superRefine((v, ctx) => {
  if (v.end < v.start || v.status !== "ok" && (v.sessions !== null || v.users !== null)) ctx.addIssue({ code: "custom", message: "归因范围或缺失指标无效" });
  if (v.status === "ok" && (v.sessions === null || v.users === null)) ctx.addIssue({ code: "custom", message: "归因成功需要实际指标" });
});
export const githubChannelSchema = z.object({
  version: z.literal(1), kind: z.literal("github-prompt-channel"), repository: z.enum(PROMPT_REPOSITORIES), observedAt: z.iso.datetime({ offset: true }), timezone: z.literal("UTC"),
  stars: metric.nullable(), forks: metric.nullable(), metadataStatus: z.enum(["ok", "unavailable"]), metadataReason: z.string().max(300).nullable(),
  views: traffic, clones: traffic, referrals: z.array(githubReferralSchema).max(8),
  linkAudit: z.object({ status: z.enum(["ok", "unavailable"]), flatkeyLinks: metric.nullable(), attributedLinks: metric.nullable(), reason: z.string().max(300).nullable() }).strict(),
}).strict().superRefine((v, ctx) => {
  if (v.metadataStatus === "unavailable" && (v.stars !== null || v.forks !== null)) ctx.addIssue({ code: "custom", message: "缺失仓库元数据不能填零" });
  if (v.metadataStatus === "ok" && (v.stars === null || v.forks === null)) ctx.addIssue({ code: "custom", message: "仓库元数据不完整" });
  if (v.linkAudit.status === "ok" && (v.linkAudit.flatkeyLinks === null || v.linkAudit.attributedLinks === null || v.linkAudit.attributedLinks > v.linkAudit.flatkeyLinks)) ctx.addIssue({ code: "custom", message: "链接归因覆盖无效" });
  if (v.linkAudit.status === "unavailable" && (v.linkAudit.flatkeyLinks !== null || v.linkAudit.attributedLinks !== null)) ctx.addIssue({ code: "custom", message: "缺失链接审计不能填零" });
  if ([...v.views.days, ...v.clones.days].some(d => d.date > v.observedAt.slice(0, 10))) ctx.addIssue({ code: "custom", message: "不接受未来流量" });
});
export type GithubChannel = z.infer<typeof githubChannelSchema>;
export const githubChannelId = (value: GithubChannel) => "github-channel:" + createHash("sha256").update(JSON.stringify(githubChannelSchema.parse(value))).digest("hex");
const shift = (date: string, n: number) => new Date(Date.parse(date + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
function series(rows: GithubChannel[], kind: "views" | "clones", cutoff: string) {
  const days = new Map<string, z.infer<typeof day>>();
  for (const row of [...rows].sort((a, b) => a.observedAt.localeCompare(b.observedAt))) if (row[kind].status === "ok") for (const point of row[kind].days) {
    // Today's UTC bucket is provisional even if the API returns it.
    if (point.date < row.observedAt.slice(0, 10) && point.date <= cutoff) days.set(point.date, point);
  }
  return days;
}
export function githubComparable(rows: GithubChannel[], kind: "views" | "clones", start: string, end: string, weekly: boolean) {
  const days = series(rows, kind, end), dates: string[] = [], previousDates: string[] = [];
  for (let d = start; d <= end; d = shift(d, 1)) if (days.has(d) && days.has(shift(d, weekly ? -7 : -1))) { dates.push(d); previousDates.push(shift(d, weekly ? -7 : -1)); }
  const expectedDays = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  const sum = (keys: string[]) => keys.length && (!weekly || keys.length === expectedDays)
    ? keys.reduce((n, d) => n + days.get(d)!.count, 0) : null;
  return { current: sum(dates), previous: sum(previousDates), dates, previousDates, expectedDays };
}
function reportReferrals(own: GithubChannel[], start: string, end: string, weekly: boolean) {
  const quality = (row: GithubChannel["referrals"][number]) => row.status === "ok" ? 2 : row.reason === "ga4_no_matching_utm_data" ? 1 : 0;
  return own.flatMap(row => row.referrals)
    .filter(row => row.end <= end && (weekly ? row.start === start && row.end === end : row.start === row.end && row.start >= shift(end, -7)))
    .sort((a, b) => b.end.localeCompare(a.end) || quality(b) - quality(a) || b.observedAt.localeCompare(a.observedAt));
}

export function githubDigestLines(rows: GithubChannel[], start: string, end: string, weekly: boolean, now: Date, compact = false) {
  const lines = ["GitHub 提示词渠道（独立于自然搜索）"];
  for (const repository of PROMPT_REPOSITORIES) {
    const own = rows.filter(r => r.repository === repository && Date.parse(r.observedAt) <= now.getTime()).sort((a, b) => b.observedAt.localeCompare(a.observedAt));
    const day = (stamp: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(stamp));
    const latest = weekly ? own.find(row => row.metadataStatus === "ok" && day(row.observedAt) <= end) : own[0];
    if (compact) {
      if (!latest) { lines.push(`• ${repository.split("/")[1]}：GitHub Traffic（${start}～${end} UTC）及 GA4 UTM（${start}～${end}，America/Los_Angeles）待更新。`); continue; }
      const views = githubComparable(own, "views", start, end, weekly), clones = githubComparable(own, "clones", start, end, weekly);
      const period = weekly ? `${shift(start, -7)}～${shift(end, -7)} 对比 ${start}～${end} UTC`
        : `${shift(start, -1)}→${end} UTC`;
      const referral = reportReferrals(own, start, end, weekly)[0];
      const arrival = referral?.status === "ok" ? `${referral.sessions}会话/${referral.users}去重访客` : referral?.reason === "ga4_no_matching_utm_data" ? "待更新（暂无匹配 UTM）" : "待更新";
      lines.push(`• [${repository.split("/")[1]}](https://github.com/${repository})：Stars ${latest.stars ?? "待更新"} / Forks ${latest.forks ?? "待更新"}（${latest.observedAt.slice(0, 10)}快照）；浏览 ${views.previous ?? "待更新"}→${views.current ?? "待更新"}，克隆 ${clones.previous ?? "待更新"}→${clones.current ?? "待更新"}；${period}；GA4 到站 ${arrival}（${referral ? `${referral.start}～${referral.end} ${referral.timezone}` : `${start}～${end} America/Los_Angeles`}${referral && referral.end < end ? `；${end} 待更新` : ""}）；UTM ${latest.linkAudit.status === "ok" ? `${latest.linkAudit.attributedLinks}/${latest.linkAudit.flatkeyLinks}` : "待更新"}。`);
      continue;
    }
    lines.push(`• [${repository}](https://github.com/${repository})`);
    if (!latest && !own.length) { lines.push("  Stars / Forks / 浏览 / 克隆 / Flatkey 到站：待更新，尚无采集回执。"); continue; }
    const metadata = latest;
    const before = own.find(r => day(r.observedAt) < start && r.metadataStatus === "ok");
    const total = (key: "stars" | "forks") => metadata?.[key] == null ? "待更新" : `${metadata[key]}${before?.[key] != null ? `（较 ${day(before.observedAt)} ${metadata[key]! - before[key]! >= 0 ? "+" : ""}${metadata[key]! - before[key]!}）` : "（上期快照待更新）"}`;
    lines.push(`  Stars ${total("stars")}；Forks ${total("forks")}；快照 ${metadata ? metadata.observedAt : "待更新"}。`);
    for (const [key, label] of [["views", "浏览次数"], ["clones", "克隆次数"]] as const) {
      const pair = githubComparable(own, key, start, end, weekly);
      const range = (days: string[]) => days.length ? `${days[0]}～${days.at(-1)}` : "无";
      const dates = weekly ? `${shift(start, -7)}～${shift(end, -7)} 对比 ${start}～${end}`
        : `${range(pair.previousDates)} 对比 ${range(pair.dates)}`;
      lines.push(`  ${label} ${pair.previous ?? "待更新"}→${pair.current ?? "待更新"}；UTC ${dates}，可比 ${pair.dates.length}/${pair.expectedDays} 日。`);
      if (!weekly && pair.dates.length === 1) { const point = series(own, key, end).get(pair.dates[0])!; lines.push(`  该UTC日去重${key === "views" ? "访客" : "克隆者"} ${point.uniques}。`); }
    }
    if (weekly) lines.push("  周去重访客/克隆者待精确区间数据；未把每日unique相加。GitHub API原始14日总数只作来源窗口，未当周报总数。");
    const referrals = reportReferrals(own, start, end, weekly);
    const referral = referrals[0];
    lines.push(referral?.status === "ok" ? `  GitHub UTM→Flatkey 到站会话 ${referral.sessions}，去重访客 ${referral.users}；${referral.start}～${referral.end} ${referral.timezone}${referral.end < end ? "，最新完整日滞后于报表目标日" : ""}。` : referral?.reason === "ga4_no_matching_utm_data" ? "  GitHub UTM→Flatkey 到站会话/访客：暂无匹配数据；未记为 0。" : "  GitHub UTM→Flatkey 到站会话/访客：待更新；没有把仓库浏览或克隆当作到站点击。");
    if (weekly) {
      const previous = own.flatMap(row => row.referrals).filter(row => row.status === "ok" && row.start === shift(start, -7) && row.end === shift(end, -7))
        .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
      if (referral?.status === "ok" && previous && previous.timezone === referral.timezone)
        lines.push(`  周到站会话 ${previous.sessions}→${referral.sessions}；周去重访客 ${previous.users}→${referral.users}。`);
    }
    if (referral?.reason === "ga4_no_matching_utm_data") lines.push(`  GA4已查询 ${referral.start}～${referral.end} ${referral.timezone}，该仓库UTM条件暂无匹配数据，未记为0。`);
    const audit = own[0];
    lines.push(audit.linkAudit.status === "ok" ? `  公开README的Flatkey链接UTM覆盖 ${audit.linkAudit.attributedLinks}/${audit.linkAudit.flatkeyLinks}；仅表示已核查链接。` : "  公开README链接归因核查待更新。");
    if (audit.views.status !== "ok" || audit.clones.status !== "ok") lines.push("  仓库Traffic来源缺失或无权限，缺失值未写0。");
  }
  lines.push("GitHub不提供仓库出站点击计数；GA4到站为带仓库UTM的真实会话，受同意与拦截影响，不是点击总量。");
  return lines;
}
