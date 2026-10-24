import type { ReactNode } from "react"
import localFont from "next/font/local"
import "./globals.css"
import DatadogRum from "@/components/DatadogRum"
import { AdminI18nProvider } from "@/i18n/client"
import { getAdminI18n, getAdminMessages } from "@/i18n/server"

const plexSans = localFont({
  src: [
    {
      path: "./fonts/IBMPlexSans-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/IBMPlexSans-Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "./fonts/IBMPlexSans-SemiBold.woff2",
      weight: "600",
      style: "normal",
    },
  ],
  display: "swap",
  variable: "--font-plex-sans",
})

const plexMono = localFont({
  src: [
    {
      path: "./fonts/IBMPlexMono-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/IBMPlexMono-Medium.woff2",
      weight: "500",
      style: "normal",
    },
  ],
  display: "swap",
  variable: "--font-plex-mono",
})

export async function generateMetadata() {
  const messages = await getAdminMessages()
  return {
    title: messages.metadata.title,
    description: messages.metadata.description,
  }
}

export default async function RootLayout({
  children,
}: {
  children: ReactNode
}) {
  const { locale, messages } = await getAdminI18n()

  return (
    <html
      lang={locale}
      className={`${plexSans.variable} ${plexMono.variable} dark`}
    >
      <body>
        <AdminI18nProvider locale={locale} messages={messages}>
          <DatadogRum />
          {children}
        </AdminI18nProvider>
      </body>
    </html>
  )
}
