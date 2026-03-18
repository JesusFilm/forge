import type { Metadata } from "next"
import Link from "next/link"
import { LogoutButton } from "./logout-button"

export const metadata: Metadata = {
  title: "Dashboard — VideoForge Manager",
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="container">
      <header
        className="card"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <strong>VideoForge</strong>
        <nav style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Link href="/dashboard/jobs">Jobs</Link>
          <Link href="/dashboard/coverage">Coverage</Link>
          <LogoutButton />
        </nav>
      </header>
      <main>{children}</main>
    </div>
  )
}
