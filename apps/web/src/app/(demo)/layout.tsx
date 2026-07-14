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

export const metadata: Metadata = {
  icons: {
    icon: [
      {
        url: "/watch/images/favicon-32.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/watch/images/favicon-180.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/watch/images/favicon-180.png",
        type: "image/png",
      },
    ],
  },
  other: {
    "msapplication-TileImage": "/watch/images/favicon-180.png",
    "apple-mobile-web-app-status-bar-style": "black",
  },
}

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
