import type { Metadata, Viewport } from "next"
import type { ReactNode } from "react"

import "./globals.css"

export const metadata: Metadata = {
  title: "jesusfilm.ai — ask anything",
  description:
    "Scripture, doubt, prayer, next steps — ask anything. Answers grounded in cited sources.",
  icons: { icon: "/brand/jfp-sign.svg" },
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
