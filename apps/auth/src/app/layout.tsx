import type { ReactNode } from "react"
import localFont from "next/font/local"
import { Noto_Serif } from "next/font/google"

import "./globals.css"

const apercu = localFont({
  src: [
    {
      path: "./fonts/Apercu Pro Medium.otf",
      style: "normal",
      weight: "500",
    },
    {
      path: "./fonts/Apercu Pro Bold.otf",
      style: "normal",
      weight: "700",
    },
  ],
  display: "swap",
  variable: "--font-apercu",
})

const notoSerif = Noto_Serif({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-noto-serif",
  weight: ["400", "500", "600"],
})

export const metadata = {
  title: "Jesus Film Auth",
  description: "Jesus Film single sign-on",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${apercu.variable} ${notoSerif.variable}`}>
        {children}
      </body>
    </html>
  )
}
