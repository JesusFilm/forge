import type { ReactNode } from "react"
import localFont from "next/font/local"
import type { Metadata, Viewport } from "next"
import "./globals.css"
import { cn } from "@/lib/utils"
import { FloatingSearchProvider } from "@/components/FloatingSearchProvider"

const montserrat = localFont({
  src: [
    {
      path: "../../public/fonts/Montserrat-VariableFont_wght.ttf",
      weight: "100 900",
      style: "normal",
    },
    {
      path: "../../public/fonts/Montserrat-Italic-VariableFont_wght.ttf",
      weight: "100 900",
      style: "italic",
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
      <body className="overflow-x-clip bg-black">
        <FloatingSearchProvider>{props.children}</FloatingSearchProvider>
      </body>
    </html>
  )
}
