import { cookies } from "next/headers"
import { MANAGER_SIDEBAR_COOKIE } from "@/lib/manager-sidebar"
import type { Metadata } from "next"
import { ManagerDashboardShell } from "@/features/shell/manager-shell"
import { DesignSystemKitchenSink } from "@/features/design-system/design-system-kitchen-sink"
import { requireAuth } from "@/lib/require-auth"

export const metadata: Metadata = {
  title: "Design System Kitchen Sink -- Studio",
}

export default async function DesignSystemKitchenSinkPage() {
  const user = await requireAuth()
  const initialSidebarCollapsed =
    (await cookies()).get(MANAGER_SIDEBAR_COOKIE)?.value === "collapsed"

  return (
    <ManagerDashboardShell
      user={user}
      initialSidebarCollapsed={initialSidebarCollapsed}
    >
      <DesignSystemKitchenSink />
    </ManagerDashboardShell>
  )
}
