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
    <div className="font-apercu grid min-h-screen grid-cols-[248px_minmax(0,1fr)] bg-[#f7f7f2] text-[#191714] max-[820px]:grid-cols-1">
      <aside className="grid min-h-screen grid-rows-[auto_1fr_auto] gap-7 border-r border-[#dedbd2] bg-[#191714] px-5 py-7 text-[#f7f7f2] max-[820px]:min-h-0 max-[820px]:grid-rows-none">
        <div>
          <div className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-[#ef3340]">
            Jesus Film
          </div>
          <h1 className="mb-0 mt-1 text-[26px] font-bold">Auth</h1>
        </div>
        <nav
          className="grid content-start gap-1.5 max-[820px]:grid-cols-2"
          aria-label="Auth operator navigation"
        >
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href as Route}
              className="inline-flex min-h-9 items-center rounded-md px-2.5 font-medium text-[#f7f7f2] no-underline hover:bg-white/8"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="grid gap-0.5 text-[#e7e5df]">
          <span>{user.name}</span>
          <small className="block text-[#78716c]">{user.email}</small>
        </div>
      </aside>
      <main className="min-w-0 p-8 max-[820px]:p-5">{children}</main>
    </div>
  )
}
