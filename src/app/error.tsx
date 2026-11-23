"use client";

import { FeedbackButton } from "@/components/FeedbackButton";
import { useTransition } from "react";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [pending, startTransition] = useTransition();
  return <main className="feedback-page-error" role="alert">
    <h1>页面暂时无法打开</h1><p>请重试；当前已保存的数据不会因此改变。</p>
    <FeedbackButton className="ui-button" pending={pending} pendingLabel="正在重新打开…" onClick={() => startTransition(reset)}>重新打开页面</FeedbackButton>
  </main>;
}
