import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "JFP DS AI Roadmap",
  description:
    "Jesus Film Project. Digital Strategy AI Roadmap. Building trusted, scalable AI capabilities to help people discover gospel content and take faithful next steps.",
  icons: {
    icon: "/favicon-32x32.png",
    apple: "/apple-touch-icon.png",
  },
  robots: {
    index: false,
    follow: false,
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  )
}
