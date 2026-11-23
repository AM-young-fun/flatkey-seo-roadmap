"use client";

import Link, { useLinkStatus } from "next/link";
import { useEffect, type ComponentProps } from "react";
import { interactionFeedback } from "@/lib/interaction-feedback";

function LinkFeedback() {
  const { pending } = useLinkStatus();
  useEffect(() => {
    if (pending) return interactionFeedback.begin("navigation", "正在打开页面…");
  }, [pending]);
  return <span data-navigation-pending={pending || undefined} aria-hidden="true" />;
}

// Let Next decide whether navigation is pending. Modified clicks, downloads,
// external links and cancelled onNavigate callbacks retain native behavior.
export default function AppLink({ children, className, ...props }: ComponentProps<typeof Link>) {
  return <Link {...props} className={[className, "feedback-link"].filter(Boolean).join(" ")}>{children}<LinkFeedback /></Link>;
}
