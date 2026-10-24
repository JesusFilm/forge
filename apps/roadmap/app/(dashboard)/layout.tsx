import DashboardShell from "@/components/DashboardShell"
import { getAllOwners, getOwnerProfile } from "@/lib/features"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const owners = getAllOwners()
  const ownerAvatars = Object.fromEntries(
    owners.map((o) => [o, getOwnerProfile(o)?.avatar ?? null]),
  )

  return (
    <DashboardShell owners={owners} ownerAvatars={ownerAvatars}>
      {children}
    </DashboardShell>
  )
}
