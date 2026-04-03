import type { Metadata } from "next"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { DashboardNav } from "@/features/nav/dashboard-nav"

export const metadata: Metadata = {
  title: "Dashboard — VideoForge Manager",
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const jwt = cookieStore.get("strapi-jwt")?.value
  if (!jwt) {
    redirect("/login")
  }

  // Read display-only user info from cookie set at login.
  // No Strapi call — avoids spurious logouts from transient upstream failures.
  const raw = cookieStore.get("manager-user")?.value
  let user = { username: "User", email: "" }
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { username?: string; email?: string }
      user = {
        username: parsed.username ?? "User",
        email: parsed.email ?? "",
      }
    } catch {
      // Corrupted cookie — use defaults, don't block the page
    }
  }

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
