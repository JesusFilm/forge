import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Seed Studio — AI Experience Creator",
  description:
    "Create themed experiences for JesusFilm using AI-powered content generation",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&display=swap"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  )
}
