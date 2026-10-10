import type { Metadata, Viewport } from "next"
import type { ReactNode } from "react"

import "../globals.css"
import { montserrat } from "@/lib/watch-font"

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noarchive: true,
      noimageindex: true,
    },
  },
  referrer: "no-referrer",
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#000000",
  colorScheme: "dark",
}

export default function PreviewLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`bg-black font-sans ${montserrat.variable}`}>
      <body className="bg-black">{children}</body>
    </html>
  )
}
