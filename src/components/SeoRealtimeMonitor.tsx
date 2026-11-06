const GA4_REALTIME_URL = "https://analytics.google.com/analytics/web/#/a248149353p541304395/realtime/overview";

export function SeoRealtimeMonitor() {
  return <section className="dailyPanel seoRealtime" aria-label="GA4 实时监控">
    <div className="seoRealtimeHeading">
      <div><h2>GA4 实时监控</h2><p className="chartNote">在 GA4 查看过去 30 分钟的全渠道活跃用户和页面浏览。</p></div>
      <a href={GA4_REALTIME_URL} target="_blank" rel="noreferrer">打开 GA4 实时报告 ↗</a>
    </div>
    <p className="chartNote">当次自然搜索会话与注册仍按日归档。GA4 实时报告不支持按该会话渠道筛选。</p>
  </section>;
}
