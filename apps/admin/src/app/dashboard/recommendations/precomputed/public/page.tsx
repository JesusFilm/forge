import Link from "next/link"
import { redirect } from "next/navigation"
import { hasPermission } from "@/auth/permissions"
import { requireSession } from "@/auth/session"
import { DashboardPageHeader, PageSection } from "@/components/admin-ui"
import { prisma } from "@/db/client"
import { loadPrecomputedPublicReadiness } from "@/services/recommendations/precomputed/public-readiness"
import { PublicPrecomputedControls } from "./controls"

export default async function PublicPrecomputedControlPage() {
  const principal = await requireSession()
  if (!hasPermission(principal, "read:recommendation-aggregates"))
    redirect("/dashboard")
  const readiness = await loadPrecomputedPublicReadiness(prisma, principal)
  return (
    <div className="flex flex-col gap-6">
      <DashboardPageHeader
        eyebrow="Recommendation operations / saved Video"
        title="A/B serving control"
        description="Review the frozen generation, measured result, and exact serving pointer before each manual transition. Building or reading a result never changes Watch serving."
        action={
          <Link
            href="/dashboard/recommendations/precomputed"
            className="text-[13px] underline underline-offset-4"
          >
            Saved connections
          </Link>
        }
      />
      <PageSection title="Live readiness" meta="BLOCKED">
        <div className="space-y-3 p-4 text-[13px]">
          <p>
            A live human/bot and tracking-loss verifier is not implemented. The
            isolated fixture can rehearse decisions, but its CTR outcome cannot
            qualify live traffic. The Admin-bound automation count excludes
            known bots and prefetches skipped by Web.
          </p>
          <ul className="list-inside list-disc space-y-1">
            {readiness.liveActivation.unresolved.map((reason) => (
              <li key={reason}>{reason.replaceAll("_", " ")}</li>
            ))}
          </ul>
          <p>
            Inspect{" "}
            <Link
              className="underline"
              href="/dashboard/recommendations/precomputed/storage"
            >
              storage
            </Link>{" "}
            and the{" "}
            <Link
              className="underline"
              href="/dashboard/recommendations/precomputed"
            >
              build report
            </Link>{" "}
            before planning a launch. No refresh schedule is enabled.
          </p>
        </div>
      </PageSection>
      <PublicPrecomputedControls
        readiness={readiness}
        canOperate={hasPermission(
          principal,
          "operate:recommendation-experiments",
        )}
        canRollback={hasPermission(principal, "rollback:recommendations")}
      />
    </div>
  )
}
