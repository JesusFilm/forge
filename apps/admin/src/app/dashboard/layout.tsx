import type { ReactNode } from "react"
import { hasPermission, type PermissionKey } from "@/auth/permissions"
import { requireSession } from "@/auth/session"
import { AdminShell } from "@/components/admin-shell"
import { getAdminMessages } from "@/i18n/server"

const dashboardPermissionKeys: PermissionKey[] = [
  "read:experiences",
  "read:videos",
  "read:reference",
  "write:experiences",
  "write:videos",
  "publish:experiences",
  "archive:experiences",
  "system:trigger-workflow",
  "system:write-derived",
  "admin:all",
]

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode
}) {
  const principal = await requireSession()
  const messages = await getAdminMessages()
  const hasDashboardAccess = dashboardPermissionKeys.some((key) =>
    hasPermission(principal, key),
  )

  if (!hasDashboardAccess) {
    return (
      <AdminShell principal={principal}>
        <div className="mx-auto mt-16 w-full max-w-xl rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6">
          <h1 className="text-xl font-semibold">
            {messages.common.access.noAccessTitle}
          </h1>
          <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
            {messages.common.access.noAccessDescription}
          </p>
          <p className="mt-4 font-mono text-[11px] text-[var(--color-text-muted)]">
            {messages.common.access.roleLabel}: {principal.role}
          </p>
        </div>
      </AdminShell>
    )
  }

  return <AdminShell principal={principal}>{children}</AdminShell>
}
