import Sidebar from "@/components/Sidebar"
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
    <>
      <Sidebar owners={owners} ownerAvatars={ownerAvatars} />
      <main className="min-h-screen pt-12 md:ml-56 md:pt-0">
        <div className="p-4 md:p-8">{children}</div>
      </main>
    </>
  )
}
