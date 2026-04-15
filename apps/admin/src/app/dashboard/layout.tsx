import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { requireSession } from "@/auth/session"
import type { Principal } from "@/auth/principal"
import { AdminShell } from "@/components/admin-shell"

export function canAccessAdminDashboard(principal: Principal): boolean {
  return principal.role === "ADMIN" || principal.role === "EDITOR"
}

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode
}) {
  const principal = await requireSession()

  if (!canAccessAdminDashboard(principal)) {
    redirect("/login?error=forbidden")
  }

  return <AdminShell principal={principal}>{children}</AdminShell>
}
