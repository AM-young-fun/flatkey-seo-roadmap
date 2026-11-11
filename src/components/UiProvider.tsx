"use client";

import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import type { ThemeConfig } from "antd";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

export const uiTheme: ThemeConfig = {
  token: {
    colorPrimary: "#2563eb",
    colorInfo: "#2563eb",
    colorPrimaryHover: "#1d4ed8",
    colorPrimaryActive: "#1e40af",
    colorText: "#34445c",
    colorTextSecondary: "#64748b",
    colorTextPlaceholder: "#8b96a6",
    colorTextDisabled: "#98a3b2",
    colorBorder: "#dfe5ed",
    colorBorderSecondary: "#e4e8ee",
    colorBgContainer: "#ffffff",
    colorBgElevated: "#ffffff",
    colorBgContainerDisabled: "#f3f5f8",
    controlHeight: 36,
    borderRadius: 6,
    fontSize: 13,
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    controlOutline: "rgba(37, 99, 235, 0.12)",
    controlOutlineWidth: 3,
    controlItemBgHover: "#f2f6fb",
    controlItemBgActive: "#edf4fb",
    controlItemBgActiveHover: "#e5effa",
    boxShadowSecondary: "0 8px 24px rgba(37, 51, 73, 0.10)",
  },
  components: {
    Select: {
      selectorBg: "#ffffff",
      hoverBorderColor: "#9eb9da",
      activeBorderColor: "#2563eb",
      activeOutlineColor: "rgba(37, 99, 235, 0.12)",
      optionSelectedBg: "#edf4fb",
      optionSelectedColor: "#2563eb",
      optionSelectedFontWeight: 500,
      optionActiveBg: "#f2f6fb",
      optionPadding: "9px 12px",
      optionHeight: 38,
      optionFontSize: 13,
      optionLineHeight: "20px",
      zIndexPopup: 1200,
    },
    Input: {
      paddingInline: 12,
      inputFontSize: 13,
      hoverBorderColor: "#9eb9da",
      activeBorderColor: "#2563eb",
      activeShadow: "0 0 0 3px rgba(37, 99, 235, 0.12)",
      hoverBg: "#ffffff",
      activeBg: "#ffffff",
    },
    InputNumber: {
      paddingInline: 12,
      hoverBorderColor: "#9eb9da",
      activeBorderColor: "#2563eb",
      activeShadow: "0 0 0 3px rgba(37, 99, 235, 0.12)",
    },
    Button: {
      defaultColor: "#435873",
      defaultBg: "#ffffff",
      defaultBorderColor: "#dfe5ed",
      defaultHoverColor: "#2563eb",
      defaultHoverBorderColor: "#9eb9da",
      defaultHoverBg: "#ffffff",
      defaultActiveColor: "#1e40af",
      defaultActiveBorderColor: "#2563eb",
      defaultActiveBg: "#edf4fb",
      defaultShadow: "none",
      primaryShadow: "none",
      fontWeight: 500,
    },
  },
};

export function UiProvider({ children }: { children: ReactNode }) {
  return <ConfigProvider
    locale={zhCN}
    theme={uiTheme}
    select={{ variant: "outlined", suffixIcon: <ChevronDown size={14} aria-hidden="true" />, classNames: { popup: { root: "uiSelectPopup" } } }}
  >{children}</ConfigProvider>;
}
