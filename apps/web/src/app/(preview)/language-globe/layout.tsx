import type { ReactNode } from "react"
import type { Viewport } from "next"
import "../../globals.css"
import { cn } from "@/lib/utils"
import { montserrat } from "@/lib/watch-font"

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#09090b",
  colorScheme: "dark",
}

export default function LanguageGlobePreviewLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <html lang="en" className={cn("bg-[#09090b]", montserrat.variable)}>
      <body className="m-0 bg-[#09090b]">{children}</body>
    </html>
  )
}
