# 纵览自然搜索注册统一口径

纵览全站注册、日报与周报共用 `/api/traffic/registrations` 的独立区间回执：Flatkey GA4 541304395，America/Los_Angeles，首次获客渠道 firstUserPrimaryChannelGroup=Organic Search，sign_up_success / totalUsers，所选完整区间去重。纵览不再读取全渠道 `/api/seo/registrations`，不把日去重人数相加作为区间人数。

趋势仅读取 `/api/traffic/daily` 的同口径每日注册，保留真实零值和缺日。7/30/90 天预设及等长对比期由现有日采补采独立区间回执；自定义区间无独立回执时显示待采集，不拼凑。国家切片没有同口径区间回执时显示未知，不回退全球值或全渠道值。最新日值可修订，实际日期显示在卡片中。通知、日报与周报发送设置不变，本次不发消息。
