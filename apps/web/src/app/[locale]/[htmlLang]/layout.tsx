import type { ReactNode } from "react"
import type { Metadata, Viewport } from "next"
import { NextIntlClientProvider } from "next-intl"
import { setRequestLocale } from "next-intl/server"
import "../../globals.css"
import { hasUiLocale } from "@/i18n/locales"
import { cn } from "@/lib/utils"
import {
  DEFAULT_LOCALE,
  resolveWatchLocaleIdentity,
  type UiLocale,
} from "@/lib/locale"
import { montserrat } from "@/lib/watch-font"
import DatadogRum from "@/components/DatadogRum"
import { FeedbackLauncher } from "@/components/FeedbackLauncher"
import { FloatingSearchProvider } from "@/components/FloatingSearchProvider"

async function loadMessages(locale: UiLocale) {
  return (await import(`../../../../messages/${locale}.json`)).default
}

function boundedUiLocale(locale: string): UiLocale {
  return hasUiLocale(locale) ? (locale as UiLocale) : DEFAULT_LOCALE
}

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

type RootLayoutProps = {
  children: ReactNode
  params: Promise<{ locale: string; htmlLang: string }>
}

export default async function RootLayout({
  children,
  params,
}: RootLayoutProps) {
  const { locale: rawLocale, htmlLang: rawHtmlLang } = await params
  const locale = boundedUiLocale(rawLocale)
  const htmlLangIdentity = resolveWatchLocaleIdentity(rawHtmlLang)
  const htmlLang =
    htmlLangIdentity.locale === locale ? htmlLangIdentity.htmlLang : locale
  setRequestLocale(locale)
  const messages = await loadMessages(locale)
  return (
    <html
      lang={htmlLang}
      dir="ltr"
      className={cn("overflow-x-clip bg-black font-sans", montserrat.variable)}
    >
      <head>
        {/* Watch pages render MuxVideo as the hero. Establishing the
            TLS handshake to Mux's image + segment hosts in the document's
            first byte cuts the LCP element's discovery delay because the
            preconnect lands before page.tsx finishes its data fetch. */}
        <link rel="preconnect" href="https://image.mux.com" />
        <link rel="preconnect" href="https://stream.mux.com" />
        <link rel="dns-prefetch" href="https://imagedelivery.net" />
      </head>
      <body className="overflow-x-clip bg-black">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <DatadogRum />
          <FloatingSearchProvider>
            <FeedbackLauncher />
            {children}
          </FloatingSearchProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
