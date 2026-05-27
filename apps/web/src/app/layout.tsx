import type { ReactNode } from "react"
import localFont from "next/font/local"
import type { Metadata, Viewport } from "next"
import "./globals.css"
import { cn } from "@/lib/utils"
import { FloatingSearchProvider } from "@/components/FloatingSearchProvider"

const montserrat = localFont({
  // Italic variable-font face was dropped — the only italic usage in
  // apps/web is the `italic` Tailwind class on a single AdventCountdown
  // paragraph, which the browser will render via synthetic-italic of the
  // upright face. Saves ~300 KB of font transfer on every route.
  src: [
    {
      path: "../../public/fonts/Montserrat-VariableFont_wght.ttf",
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

export default function RootLayout(props: { children: ReactNode }) {
  return (
    <html
      lang="en"
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
        <FloatingSearchProvider>{props.children}</FloatingSearchProvider>
      </body>
    </html>
  )
}
