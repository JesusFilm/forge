import type { Metadata } from "next"
import "./globals.css"
import Sidebar from "@/components/Sidebar"
import { getAllOwners, getOwnerProfile } from "@/lib/features"

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
  const owners = getAllOwners()
  const ownerAvatars = Object.fromEntries(
    owners.map((o) => [o, getOwnerProfile(o)?.avatar ?? null]),
  )

  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        <Sidebar owners={owners} ownerAvatars={ownerAvatars} />
        <main className="min-h-screen pt-12 md:ml-56 md:pt-0">
          <div className="p-4 md:p-8">{children}</div>
        </main>
      </body>
    </html>
  )
}
