"use client";

import type { ButtonHTMLAttributes } from "react";
import { LoaderCircle } from "lucide-react";

export function FeedbackButton({ pending = false, pendingLabel = "正在处理…", children, disabled, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { pending?: boolean; pendingLabel?: string }) {
  return <button type="button" {...props} disabled={disabled || pending} aria-busy={pending || undefined}>
    {pending ? <><LoaderCircle size={14} className="feedback-spinner" aria-hidden="true" />{pendingLabel}</> : children}
  </button>;
}
