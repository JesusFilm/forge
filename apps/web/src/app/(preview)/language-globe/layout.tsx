import type { ReactNode } from "react"
import type { Viewport } from "next"

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
  return <div className="min-h-screen bg-[#09090b]">{children}</div>
}
