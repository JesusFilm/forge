import type { ReactNode } from "react"
import "@fontsource/ibm-plex-mono/latin-400.css"
import "@fontsource/ibm-plex-mono/latin-500.css"
import "@fontsource/ibm-plex-sans/latin-400.css"
import "@fontsource/ibm-plex-sans/latin-500.css"
import "@fontsource/ibm-plex-sans/latin-600.css"
import "./globals.css"
import DatadogRum from "@/components/DatadogRum"
import { AdminI18nProvider } from "@/i18n/client"
import { getAdminI18n, getAdminMessages } from "@/i18n/server"

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
    <html lang={locale} className="dark">
      <body>
        <AdminI18nProvider locale={locale} messages={messages}>
          <DatadogRum />
          {children}
        </AdminI18nProvider>
      </body>
    </html>
  )
}
