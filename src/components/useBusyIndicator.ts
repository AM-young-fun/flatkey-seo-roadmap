"use client";

import { useEffect } from "react";
import { interactionFeedback, type FeedbackKind } from "@/lib/interaction-feedback";

export function useBusyIndicator(pending: boolean, label: string, kind: FeedbackKind = "action") {
  useEffect(() => {
    if (pending) return interactionFeedback.begin(kind, label);
  }, [pending, label, kind]);
}
