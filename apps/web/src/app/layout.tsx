import type { ReactNode } from "react"
import { headers } from "next/headers"
import localFont from "next/font/local"
import type { Metadata, Viewport } from "next"
import { NextIntlClientProvider } from "next-intl"
import { getLocale, setRequestLocale } from "next-intl/server"
import "./globals.css"
import { hasUiLocale } from "@/i18n/locales"
import { cn } from "@/lib/utils"
import { DEFAULT_LOCALE, resolveUiLocale } from "@/lib/locale"
import { stripHtmlSuffix } from "@/lib/url-shape"
import { FloatingSearchProvider } from "@/components/FloatingSearchProvider"

// Proxy.ts sets x-watch-pathname on every watch request so the layout
// can derive the UI chrome locale BEFORE the page handler runs.
// Layouts render before pages in App Router; without this header we'd
// fall back to DEFAULT_LOCALE for every <html lang> render.
const PATHNAME_HEADER = "x-watch-pathname"

async function deriveLocaleFromUrl(): Promise<string> {
  const hdrs = await headers()
  const pathname = hdrs.get(PATHNAME_HEADER) ?? ""
  // Last URL segment carries the locale for every shape in the watch
  // URL contract: 1-seg /{lang}.html, 2-seg /{slug}.html/{lang}.html,
  // 3-seg /{series}.html/{episode}/{lang}.html. Stripping .html and
  // resolving through the bcp47 family fallback collapses each into
  // its UI chrome locale; non-locale tails (e.g. "jesus.html",
  // "videos") fall through to DEFAULT_LOCALE.
  const segments = pathname.split("/").filter(Boolean)
  const tail = segments[segments.length - 1]
  if (!tail) return DEFAULT_LOCALE
  const stripped = stripHtmlSuffix(tail)
  const resolved = resolveUiLocale(stripped) ?? DEFAULT_LOCALE
  return hasUiLocale(resolved) ? resolved : DEFAULT_LOCALE
}

const montserrat = localFont({
  // Italic variable-font face was dropped — the only italic usage in
  // apps/web is the `italic` Tailwind class on a single AdventCountdown
  // paragraph, which the browser will render via synthetic-italic of the
  // upright face. Saves ~300 KB of font transfer on every route.
  //
  // The face ships as woff2 (~205 KB) rather than ttf (~688 KB raw /
  // ~280 KB gz) — woff2's native brotli compression beats the response-
  // path gzip Next.js applies to ttf transfers.
  src: [
    {
      path: "../../public/fonts/Montserrat-VariableFont_wght.woff2",
      weight: "100 900",
      style: "normal",
    },
  ],
  variable: "--font-montserrat",
  fallback: [
    "Avenir Next",
    "Avenir",
    "Helvetica Neue",
    "Helvetica",
    "Segoe UI",
    "Roboto",
    "Noto Sans",
    "Liberation Sans",
    "Arial",
    "sans-serif",
  ],
  display: "swap",
})

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

export default async function RootLayout(props: { children: ReactNode }) {
  // Layout renders BEFORE pages, so we can't rely on the page handler
  // to have populated the next-intl request store yet. Derive locale
  // from the proxy-set pathname header, then setRequestLocale so any
  // server component down the tree (including the page) sees the same
  // locale. getLocale() returns the set value; pages still call
  // setRequestLocale defensively, but the source of truth is here.
  const derived = await deriveLocaleFromUrl()
  setRequestLocale(derived)
  const locale = await getLocale()
  return (
    <html
      lang={locale}
      dir="ltr"
      className={cn("overflow-x-clip bg-black font-sans", montserrat.variable)}
    >
      <head>
        {/* Watch pages render <mux-player> as the hero. Establishing the
            TLS handshake to Mux's image + segment hosts in the document's
            first byte cuts the LCP element's discovery delay because the
            preconnect lands before page.tsx finishes its data fetch. */}
        <link rel="preconnect" href="https://image.mux.com" />
        <link rel="preconnect" href="https://stream.mux.com" />
        <link rel="dns-prefetch" href="https://imagedelivery.net" />
      </head>
      <body className="overflow-x-clip bg-black">
        <NextIntlClientProvider>
          <FloatingSearchProvider>{props.children}</FloatingSearchProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
