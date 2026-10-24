import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Subtitle Review Editor",
  description: "Forge-hosted subtitle review editor",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
