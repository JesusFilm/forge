import type { Metadata } from "next"
import { DashboardNav } from "@/features/nav/dashboard-nav"
import { requireAuth } from "@/lib/require-auth"

export const metadata: Metadata = {
  title: "Dashboard — VideoForge Manager",
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireAuth()

  return (
    <main className="dashboard-main">
      <div className="report-shell">
        <header className="report-header">
          <div className="header-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/jesusfilm-sign.svg"
              alt="Jesus Film Project"
              className="header-logo"
            />
          </div>
          <DashboardNav />
        </header>
        {children}
      </div>
    </main>
  )
}
