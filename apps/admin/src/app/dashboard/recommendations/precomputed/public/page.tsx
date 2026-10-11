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
            Verified-browser incumbent visits and accepted clicks are measured
            separately from Web request-health counters. Missing Web hours,
            incomplete tracking, fixture-only evidence, and the unagreed live
            stopping policy keep launch blocked. No winner is activated
            automatically. A quiet hour and a telemetry outage currently look
            the same to Web; missing hours remain unknown rather than counting
            as zero traffic.
          </p>
          <ul className="list-inside list-disc space-y-1">
            {readiness.liveActivation.unresolved.map((reason) => (
              <li key={reason}>{reason.replaceAll("_", " ")}</li>
            ))}
          </ul>
          {readiness.authoritativeCatalogCoverage ? (
            <p>
              Admin catalog coverage at the build cutoff:{" "}
              {readiness.authoritativeCatalogCoverage
                .authoritativeSourceCount ?? "unavailable"}{" "}
              eligible Videos versus{" "}
              {readiness.authoritativeCatalogCoverage.generationSourceCount} in
              the generation. Both the count and source-set digest must match
              before live preparation.
            </p>
          ) : null}
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
