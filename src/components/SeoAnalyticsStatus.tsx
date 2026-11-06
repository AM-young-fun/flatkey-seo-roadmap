import { shanghaiStamp, type AnalyticsSource } from "./useSeoAnalytics";

const statusText: Record<AnalyticsSource["status"], string> = {
  ready: "已采集",
  partial: "部分已采集",
  missing: "待采集",
  error: "读取异常",
};

export function SeoAnalyticsStatus({ name, source }: { name: string; source: AnalyticsSource }) {
  return <div className="seoSourceStatus">
    <strong>{name}</strong>
    <span className="seoDataBadge" data-status={source.status}>{statusText[source.status]}</span>
    {source.through ? <span>最新数据日 {source.through}</span> : null}
    {source.observedAt ? <span>最近采集 {shanghaiStamp(source.observedAt)}（北京时间）</span> : null}
    {source.reason ? <small>{source.reason}</small> : null}
  </div>;
}
