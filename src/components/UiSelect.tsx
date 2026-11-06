"use client";

import { Select, type SelectProps } from "antd";
import type { CSSProperties, ReactNode } from "react";

export type UiSelectOption =
  | { value: string; label: ReactNode; disabled?: boolean }
  | { label: ReactNode; options: UiSelectOption[]; value?: never; disabled?: never };

export type UiSelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: UiSelectOption[];
  "aria-label": string;
  className?: string;
  id?: string;
  disabled?: boolean;
  placeholder?: ReactNode;
  style?: CSSProperties;
  getPopupContainer?: SelectProps<string>["getPopupContainer"];
  onOpenChange?: SelectProps<string>["onOpenChange"];
  onInputKeyDown?: SelectProps<string>["onInputKeyDown"];
};

/** One shared DOM-based dropdown, including its open menu and keyboard states. */
export function UiSelect({ className, ...props }: UiSelectProps) {
  return <Select<string>
    {...props}
    className={["uiSelect", className].filter(Boolean).join(" ")}
    classNames={{ popup: { root: "uiSelectPopup" } }}
    variant="outlined"
    showSearch={false}
    virtual={false}
    listHeight={280}
    popupMatchSelectWidth
  />;
}
