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
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <nav
        style={{
          width: 220,
          padding: "1.5rem 1rem",
          borderRight: "1px solid #e5e7eb",
          background: "#f9fafb",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <h2
          style={{
            fontSize: "1.125rem",
            fontWeight: 700,
            marginBottom: "1.5rem",
          }}
        >
          VideoForge
        </h2>
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
            flex: 1,
          }}
        >
          <li>
            <Link
              href="/dashboard"
              style={{ textDecoration: "none", color: "#374151" }}
            >
              Overview
            </Link>
          </li>
          <li>
            <Link
              href="/dashboard/jobs"
              style={{ textDecoration: "none", color: "#374151" }}
            >
              Jobs
            </Link>
          </li>
          <li>
            <Link
              href="/dashboard/coverage"
              style={{ textDecoration: "none", color: "#374151" }}
            >
              Coverage
            </Link>
          </li>
        </ul>
        <LogoutButton />
      </nav>
      <main style={{ flex: 1, padding: "1.5rem" }}>{children}</main>
    </div>
  )
}
