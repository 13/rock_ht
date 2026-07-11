import type { Metadata, Viewport } from "next";
import { Providers } from "@/providers/providers";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: {
    template: "%s | sisiGo",
    default: "sisiGo — Build habits that stick",
  },
  description:
    "The minimal, beautiful habit tracker that keeps you consistent without the noise.",
  keywords: ["habit tracker", "habits", "productivity", "consistency", "streaks"],
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "sisiGo",
  },
  openGraph: {
    title: "sisiGo",
    description: "Build habits that stick",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0f" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
      </head>
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
