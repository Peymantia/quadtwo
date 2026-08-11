import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./skins/studio.css";
import { ThemeBoot } from "../components/ThemeBoot";
import { THEME_BOOT_SCRIPT } from "../lib/theme";

export const metadata: Metadata = {
  title: "داشبورد پیـنگ",
  description: "داشبورد مدیریت پیـنگ",
  applicationName: "پیـنگ",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
    shortcut: [{ url: "/icon-192.png", type: "image/png", sizes: "192x192" }],
  },
  appleWebApp: {
    capable: true,
    title: "پیـنگ",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" data-skin="classic" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Vazirmatn:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      {/* Telegram SDK is loaded on-demand via lib/telegram.ts — not here.
          Loading telegram.org beforeInteractive breaks the app when CDN is blocked. */}
      <body>
        <ThemeBoot />
        {children}
      </body>
    </html>
  );
}
