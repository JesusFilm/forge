import Link from "next/link"
import { redirect } from "next/navigation"
import { hasPermission } from "@/auth/permissions"
import { requireSession } from "@/auth/session"
import { DashboardPageHeader, PageSection } from "@/components/admin-ui"
import { env } from "@/config/env"
import { prisma } from "@/db/client"
import {
  listPrivatePrecomputedExperiments,
  loadPrivatePrecomputedVisitDiagnostics,
} from "@/services/recommendations/precomputed/visit-admission"
import { createPrivatePrecomputedTest } from "./actions"
import { PrivateVisitDiagnosticsView } from "./view"

export default async function PrecomputedVisitDiagnosticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const principal = await requireSession()
  if (!hasPermission(principal, "read:recommendation-aggregates"))
    redirect("/dashboard")
  const params = await searchParams
  const requested =
    typeof params.experiment === "string" && params.experiment.length <= 191
      ? params.experiment.trim()
      : ""
  const experiments = await listPrivatePrecomputedExperiments(prisma, principal)
  const id = requested || experiments[0]?.id
  const report = id
    ? await loadPrivatePrecomputedVisitDiagnostics(prisma, {
        experimentId: id,
        reviewer: principal,
      })
    : null

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageHeader
        eyebrow="Recommendation operations / private A/B"
        title="Saved Video test visits"
        description="Inspect eligible Watch visits by assigned arm, including empty and failed delivery. These counts are private observations; bot qualification and public launch evidence remain unverified."
        action={
          <Link
            href="/dashboard/recommendations/precomputed"
            className="text-[13px] underline underline-offset-4"
          >
            Saved connections
          </Link>
        }
      />
      <PageSection
        title="Private test configuration"
        meta="NO PUBLIC ACTIVATION"
      >
        <div className="space-y-3 p-4 text-[13px]">
          {experiments.length ? (
            <form
              action="/dashboard/recommendations/precomputed/visits"
              method="get"
              className="flex flex-wrap items-end gap-3"
            >
              <label>
                Experiment
                <select
                  name="experiment"
                  defaultValue={id}
                  className="ml-2 border border-[var(--color-hairline)] bg-transparent p-2"
                >
                  {experiments.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.id} · {item.state}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="border border-[var(--color-hairline)] px-3 py-2"
              >
                Inspect
              </button>
            </form>
          ) : (
            <p>No private test has been configured.</p>
          )}
          {hasPermission(principal, "operate:recommendation-experiments") &&
          env.RECOMMENDATION_PRECOMPUTED_TEST_ENABLED === "1" ? (
            <form
              action={createPrivatePrecomputedTest}
              className="grid gap-3 border-t border-[var(--color-hairline)] pt-3 md:grid-cols-4"
            >
              <label>
                Complete generation ID
                <input
                  name="generationId"
                  required
                  maxLength={191}
                  className="mt-1 block w-full border border-[var(--color-hairline)] bg-transparent p-2"
                />
              </label>
              <label>
                Starts at (UTC)
                <input
                  name="startsAt"
                  type="text"
                  placeholder="2026-10-05T08:00:00Z"
                  required
                  className="mt-1 block w-full border border-[var(--color-hairline)] bg-transparent p-2"
                />
              </label>
              <label>
                Ends at (UTC)
                <input
                  name="endsAt"
                  type="text"
                  placeholder="2026-10-12T08:00:00Z"
                  required
                  className="mt-1 block w-full border border-[var(--color-hairline)] bg-transparent p-2"
                />
              </label>
              <button
                type="submit"
                className="self-end border border-[var(--color-hairline)] px-3 py-2"
              >
                Create private test
              </button>
            </form>
          ) : null}
        </div>
      </PageSection>
      <PrivateVisitDiagnosticsView report={report} />
    </div>
  )
}
