import { cohortDefinitions, cohortKinds, cohortStatusLabels, type ApiCohort } from "@/lib/seo-api-cohorts";
import type { DateRange } from "@/lib/seo-date-range";
import styles from "./SeoBusinessAnalytics.module.css";

export type CohortPeriodLink = { kind: ApiCohort["kind"]; start: string; end: string; observationEnd: string };
export function SeoApiCohorts({ cohorts, range, periods, onRangeSelect, collectionPresent = false }: { cohorts?: ApiCohort[]; range: DateRange; periods?: CohortPeriodLink[]; onRangeSelect?: (range: DateRange) => void; collectionPresent?: boolean }) {
  return <section aria-labelledby="api-cohort-title">
    <h3 id="api-cohort-title">API 注册后转化</h3>
    <p className={styles.note}>注册区间 {range.start}—{range.end} · 国家和来源按注册时判断，后续直接访问也计入。</p>
    {onRangeSelect && !!periods?.length && <div className={styles.cohortLinks}>{periods.map(period => <button type="button" key={period.kind} onClick={() => onRangeSelect({ start: period.start, end: period.end })} disabled={period.start === range.start && period.end === range.end}>查看已归档 {period.kind === "api-first-success-d7" ? "D7" : "D30"} · 注册 {period.start}—{period.end}</button>)}</div>}
    <div className={styles.cohorts}>{cohortKinds.map(kind => {
      const cohort = cohorts?.find(value => value.kind === kind);
      const ready = cohort?.status === "ready";
      return <article key={kind} className={styles.cohort} aria-label={cohortDefinitions[kind].label}>
        <div className={styles.cohortHeading}><strong>{cohortDefinitions[kind].label}</strong><span>{cohort ? cohortStatusLabels[cohort.status] : collectionPresent ? "未启用" : "待采集"}</span></div>
        <div className={styles.cohortRate}>{ready && cohort.rate !== null ? `${(cohort.rate * 100).toFixed(1)}%` : "—"}</div>
        <p className={styles.note}>{ready ? `${cohort.convertedUsers} / ${cohort.registeredUsers} 名可观测注册用户` : cohort?.status === "unconfigured" ? "观察起点与身份覆盖待核验" : cohort?.status === "no_users" ? "本区间无可观测注册用户，不计算比率" : cohort?.status === "insufficient_coverage" ? `完整覆盖从 ${cohort.firstEligibleRegistrationDay} 起` : !cohort ? collectionPresent ? "观察起点与身份覆盖待核验" : "该注册时段尚无统计结果" : cohort?.status === "immature" ? "等待完整观察窗口与 48 小时处理缓冲" : "数据待核验，不推算转化率"}</p>
        {cohort && <p className={styles.note}>观察至 {cohort.observationEnd} · {cohort.timezone}</p>}
      </article>;
    })}</div>
    <p className={styles.note}>按同一批注册用户统计，仅包含允许统计且可关联身份的用户。两项分别计算；观察期未结束或数据不足时不显示比例。</p>
    <details><summary>统计口径</summary>
      <p className={styles.note}>采用 GA4 报告身份与漏斗 activeUsers。首次成功在注册后 604800 秒内；首次付费在注册后 2592000 秒内，付款可以早于使用。保留后续正式服务域名事件，不要求仍属自然搜索。注册日期按属性时区分组，整段观察结束后再留 48 小时处理缓冲；数据仍可能后续修订。仅设置起点不会回补历史缺失的注册或用户身份。</p>
      {(cohorts ?? []).map(cohort => <p key={cohort.kind} className={styles.note}>{cohortDefinitions[cohort.kind].label} · 覆盖起点 {cohort.coverageStart ?? "未配置"} · 最早成熟 {cohort.matureAt} · 采集 {cohort.observedAt}{cohort.reasons.length ? " · " + cohort.reasons.join("、") : ""}</p>)}
    </details>
  </section>;
}
