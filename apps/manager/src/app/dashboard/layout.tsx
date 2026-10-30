import { cookies } from "next/headers"
import { MANAGER_SIDEBAR_COOKIE } from "@/lib/manager-sidebar"
import "video.js/dist/video-js.css"
import type { Metadata } from "next"
import { ManagerDashboardShell } from "@/features/shell/manager-shell"
import { requireAuth } from "@/lib/require-auth"

export const metadata: Metadata = {
  title: "Dashboard — Studio",
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireAuth()
  const initialSidebarCollapsed =
    (await cookies()).get(MANAGER_SIDEBAR_COOKIE)?.value === "collapsed"

  return (
    <ManagerDashboardShell
      user={user}
      initialSidebarCollapsed={initialSidebarCollapsed}
    >
      {children}
    </ManagerDashboardShell>
  )
}
