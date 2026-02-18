import type { ReactNode } from "react"
import "./globals.css"
import { Layout } from "../components/Layout"

export default function RootLayout(props: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <Layout>{props.children}</Layout>
      </body>
    </html>
  )
}
