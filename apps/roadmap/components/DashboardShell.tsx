"use client"

import { usePathname } from "next/navigation"
import Sidebar from "@/components/Sidebar"
import TopNav from "@/components/TopNav"

export default function DashboardShell({
  owners,
  ownerAvatars,
  children,
}: {
  owners: string[]
  ownerAvatars: Record<string, string | null>
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const usesTopNav = pathname === "/roadmap" || pathname === "/contributions"

  if (usesTopNav) {
    return (
      <>
        <TopNav />
        <main className="min-h-screen">
          <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
            {children}
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Sidebar owners={owners} ownerAvatars={ownerAvatars} />
      <main className="min-h-screen pt-12 md:ml-56 md:pt-0">
        <div className="p-4 md:p-8">{children}</div>
      </main>
    </>
  )
}
