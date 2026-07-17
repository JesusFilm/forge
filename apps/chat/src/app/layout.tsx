import type { Metadata, Viewport } from "next"
import type { ReactNode } from "react"

import "./globals.css"

export const metadata: Metadata = {
  title: "Forge Chat",
  description: "Chat UI for the Forge Mastra agents (jesusfilm.ai).",
}

export const viewport: Viewport = {
  // Keeps the dvh-sized composer above the mobile soft keyboard.
  interactiveWidget: "resizes-content",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
