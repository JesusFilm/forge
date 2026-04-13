import "video.js/dist/video-js.css"
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
  const user = await requireAuth()

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
          <div id="report-header-slot" className="report-header-slot" />
          <DashboardNav user={user} />
        </header>
        {children}
        <footer className="dashboard-footer">
          <p className="dashboard-footer-slogan">
            <span className="dashboard-footer-ref">Acts 2:6–8</span>
            &ldquo;Each one heard them speaking in his own language…&rdquo;
          </p>
        </footer>
      </div>
    </main>
  )
}
