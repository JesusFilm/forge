import type { ReactNode } from "react"
import type { Metadata, Viewport } from "next"
import { NextIntlClientProvider } from "next-intl"
import { setRequestLocale } from "next-intl/server"
import "../globals.css"
import { FeedbackLauncher } from "@/components/FeedbackLauncher"
import { FloatingSearchProvider } from "@/components/FloatingSearchProvider"
import { DEFAULT_LOCALE } from "@/lib/locale"
import { cn } from "@/lib/utils"
import { montserrat } from "@/lib/watch-font"
import { WATCH_APP_METADATA } from "@/lib/watch-app-metadata"

export const metadata: Metadata = WATCH_APP_METADATA

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#000000",
  colorScheme: "dark",
}

export default function DemoRootLayout({ children }: { children: ReactNode }) {
  setRequestLocale(DEFAULT_LOCALE)
  return (
    <html
      lang={DEFAULT_LOCALE}
      dir="ltr"
      className={cn("overflow-x-clip bg-black font-sans", montserrat.variable)}
    >
      <body className="overflow-x-clip bg-black">
        <NextIntlClientProvider>
          <FloatingSearchProvider>
            <FeedbackLauncher />
            {children}
          </FloatingSearchProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
