"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useTransition } from "react";
import { interactionFeedback } from "@/lib/interaction-feedback";

export function useFeedbackRouter() {
  const router = useRouter(), [pending, startTransition] = useTransition();
  useEffect(() => {
    if (pending) return interactionFeedback.begin("navigation", "正在切换页面…");
  }, [pending]);
  return useMemo(() => ({ ...router,
    push: (...args: Parameters<typeof router.push>) => startTransition(() => router.push(...args)),
    replace: (...args: Parameters<typeof router.replace>) => startTransition(() => router.replace(...args)),
    refresh: () => startTransition(() => router.refresh()),
  }), [router, startTransition]);
}
