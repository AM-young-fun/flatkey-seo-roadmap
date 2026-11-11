import { UiProvider } from "@/components/UiProvider";
import { PreviewModeProvider } from "@/components/PreviewMode";
import type { Metadata } from "next";
import "antd/dist/reset.css";
import "./globals.css";
import "@/components/UiControls.css";
import "./workspace-foundation.css";

export const metadata: Metadata = {
  title: "Flatkey SEO",
  description: "Flatkey SEO 工作台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body><UiProvider><PreviewModeProvider enabled={process.env.NODE_ENV === "development" && Boolean(process.env.SEO_PREVIEW_UPSTREAM_TOKEN)}>{children}</PreviewModeProvider></UiProvider></body>
    </html>
  );
}
