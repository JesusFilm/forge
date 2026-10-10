import type { Metadata } from "next"
import "./globals.css"
import { GlobalShell } from "./global-shell"
import { MANAGER_THEME_INITIALIZER } from "@/lib/manager-theme"

export const metadata: Metadata = {
  title: "Studio",
  description: "AI video enrichment pipeline dashboard",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: MANAGER_THEME_INITIALIZER }}
        />
      </head>
      <body>
        <GlobalShell>{children}</GlobalShell>
      </body>
    </html>
  )
}
