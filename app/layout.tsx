import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LocalDrop — 局域网文件快传",
  description: "无需上传云端，在同一局域网内安全、快速地传输文件。",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
