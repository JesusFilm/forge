import type { ReactNode } from "react"
import localFont from "next/font/local"
import type { Metadata } from "next"
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
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
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
  },
}

export default function RootLayout(props: { children: ReactNode }) {
  return (
    <html
      lang="en"
      dir="ltr"
      className={cn("overflow-x-clip font-sans", montserrat.variable)}
    >
      <body className="overflow-x-clip bg-stone-900">
        <FloatingSearchProvider>{props.children}</FloatingSearchProvider>
      </body>
    </html>
  )
}
