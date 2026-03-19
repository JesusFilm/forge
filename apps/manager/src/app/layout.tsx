import type { Metadata } from "next"
import "./globals.css"
import { GlobalShell } from "./global-shell"

export const metadata: Metadata = {
  title: "VideoForge Manager",
  description: "AI video enrichment pipeline dashboard",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <GlobalShell>{children}</GlobalShell>
      </body>
    </html>
  )
}
