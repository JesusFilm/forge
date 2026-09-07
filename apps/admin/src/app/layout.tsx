import type { ReactNode } from "react"
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google"
import "./globals.css"
import DatadogRum from "@/components/DatadogRum"
import { AdminI18nProvider } from "@/i18n/client"
import { getAdminI18n, getAdminMessages } from "@/i18n/server"

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-plex-sans",
  weight: ["400", "500", "600"],
})

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  weight: ["400", "500"],
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
