"use client";

import { useState, type ReactNode } from "react";

export function SeoHistoryDisclosure({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details className="dailyPanel seoHistory" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>首次自然搜索获客 · 历史记录</summary>
    {open ? <><p className="chartNote">历史数据按用户的首次获客渠道归类。当前趋势按当次会话渠道统计，两种口径独立查看。</p>{children}</> : null}
  </details>;
}
