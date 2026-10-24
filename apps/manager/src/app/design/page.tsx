import type { Metadata } from "next"
import { ManagerDashboardShell } from "@/features/shell/manager-shell"
import { DesignSystemKitchenSink } from "@/features/design-system/design-system-kitchen-sink"
import { requireAuth } from "@/lib/require-auth"

export const metadata: Metadata = {
  title: "Design System Kitchen Sink -- Studio",
}

export default async function DesignSystemKitchenSinkPage() {
  const user = await requireAuth()

  return (
    <ManagerDashboardShell user={user}>
      <DesignSystemKitchenSink />
    </ManagerDashboardShell>
  )
}
