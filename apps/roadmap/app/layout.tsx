import type { Metadata } from "next"
import "./globals.css"
import Sidebar from "@/components/Sidebar"
import { getAllOwners } from "@/lib/features"

export const metadata: Metadata = {
  title: "JFP Roadmap",
  description: "Project roadmap dashboard",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const owners = getAllOwners()

  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        <Sidebar owners={owners} />
        <main className="min-h-screen pt-12 md:ml-56 md:pt-0">
          <div className="p-4 md:p-8">{children}</div>
        </main>
      </body>
    </html>
  )
}
