import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { requireSession } from "@/auth/session"
import type { Principal } from "@/auth/principal"
import { AdminShell } from "@/components/admin-shell"
import { prisma } from "@/db/client"

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
    redirect("/access-request?error=forbidden")
  }

  const profile = principal.id
    ? await prisma.user.findUnique({
        where: { id: principal.id },
        select: { name: true, email: true, image: true },
      })
    : null

  return (
    <AdminShell principal={principal} profile={profile}>
      {children}
    </AdminShell>
  )
}
