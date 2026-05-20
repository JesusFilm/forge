import type { ReactNode } from "react"
import localFont from "next/font/local"
import "./globals.css"
import { cn } from "@/lib/utils"
import { FloatingSearchProvider } from "@/components/FloatingSearchProvider"

const apercuPro = localFont({
  src: [
    { path: "../../public/fonts/Apercu-Pro-Regular.woff2", weight: "400" },
    { path: "../../public/fonts/Apercu-Pro-Medium.woff2", weight: "500" },
    { path: "../../public/fonts/Apercu-Pro-Bold.woff2", weight: "700" },
    {
      path: "../../public/fonts/Apercu-Pro-MediumItalic.woff2",
      weight: "500",
      style: "italic",
    },
    {
      path: "../../public/fonts/Apercu-Pro-BoldItalic.woff2",
      weight: "700",
      style: "italic",
    },
  ],
  variable: "--font-sans",
  display: "swap",
})

export default function RootLayout(props: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" className={cn("font-sans", apercuPro.variable)}>
      <body className="bg-stone-900">
        <FloatingSearchProvider>{props.children}</FloatingSearchProvider>
      </body>
    </html>
  )
}
