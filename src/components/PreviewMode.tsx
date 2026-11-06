"use client";

import { createContext, useContext, type ReactNode } from "react";
const PreviewMode = createContext(false);
export function PreviewModeProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <PreviewMode.Provider value={enabled}>{children}</PreviewMode.Provider>;
}
export const usePreviewMode = () => useContext(PreviewMode);
