"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { interactionFeedback } from "@/lib/interaction-feedback";

export function useActionFeedback(label: string) {
  const [pending, setPending] = useState(false);
  const flight = useRef<(() => void) | null>(null);
  const start = useCallback(() => {
    if (flight.current) return false;
    flight.current = interactionFeedback.begin("action", label);
    setPending(true);
    return true;
  }, [label]);
  const finish = useCallback(() => {
    flight.current?.(); flight.current = null; setPending(false);
  }, []);
  useEffect(() => () => { flight.current?.(); flight.current = null; }, []);
  return { pending, start, finish };
}
