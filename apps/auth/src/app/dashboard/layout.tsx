import Link from "next/link"
import type { Route } from "next"
import type { ReactNode } from "react"

import { requireAuthOperator } from "@/auth/operator"

const navItems = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/apps", label: "Apps" },
  { href: "/dashboard/users", label: "Users" },
  { href: "/dashboard/tokens", label: "Tokens" },
  { href: "/dashboard/audit", label: "Audit" },
]

export const dynamic = "force-dynamic"

export default async function DashboardLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const user = await requireAuthOperator()

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div>
          <div className="dashboard-kicker">Jesus Film</div>
          <h1>Auth</h1>
        </div>
        <nav aria-label="Auth operator navigation">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href as Route}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="dashboard-user">
          <span>{user.name}</span>
          <small>{user.email}</small>
        </div>
      </aside>
      <main className="dashboard-main">{children}</main>
    </div>
  )
}
