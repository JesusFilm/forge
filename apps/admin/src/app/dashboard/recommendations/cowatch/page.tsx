import Link from "next/link"
import { redirect } from "next/navigation"
import { hasPermission } from "@/auth/permissions"
import { requireSession } from "@/auth/session"
import { DashboardPageHeader, PageSection } from "@/components/admin-ui"

export default async function CowatchInspectionPage() {
  const principal = await requireSession()
  if (!hasPermission(principal, "read:recommendation-aggregates"))
    redirect("/dashboard")
  return (
    <div className="flex flex-col gap-6">
      <DashboardPageHeader
        eyebrow="Recommendation operations"
        title="Directional co-watch retired"
        description="Behavioral co-watch learning and its stored rows have been retired."
        action={
          <Link href="/dashboard/recommendations" className="underline">
            Recommendations
          </Link>
        }
      />
      <PageSection title="Historical feature" meta="RETIRED">
        <p className="p-4 text-[13px] text-[var(--color-text-secondary)]">
          Semantic and metadata recommendations remain available. Historical
          co-watch evidence remains in archived receipts, not this live view.
        </p>
      </PageSection>
    </div>
  )
}
