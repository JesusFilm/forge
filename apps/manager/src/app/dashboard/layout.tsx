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

  return <ManagerDashboardShell user={user}>{children}</ManagerDashboardShell>
}
