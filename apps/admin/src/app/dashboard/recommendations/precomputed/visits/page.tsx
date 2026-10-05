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
import { loadPrivatePrecomputedClickDiagnostics } from "@/services/recommendations/precomputed/visit-clicks"
import {
  loadPrivatePrecomputedCtrIndex,
  loadPrivatePrecomputedCtrReport,
} from "@/services/recommendations/precomputed/ctr-report"
import { createPrivatePrecomputedTest } from "./actions"
import { PrivateCtrReportView } from "./ctr-view"
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
  const clicks = id
    ? await loadPrivatePrecomputedClickDiagnostics(prisma, {
        experimentId: id,
        reviewer: principal,
      })
    : null
  const requestedRevision =
    typeof params.revision === "string" && /^[1-9]\d?$/.test(params.revision)
      ? Number(params.revision)
      : undefined
  const evaluationMessage =
    params.evaluation === "provisional_revision_capacity_exhausted"
      ? "the 32 provisional revisions are full; the final fixed-horizon slot remains reserved"
      : params.evaluation === "predeclared_policy_missing"
        ? "a policy must be declared before visits"
        : params.evaluation === "policy_integrity_failed"
          ? "the stored policy did not pass its integrity check"
          : params.evaluation === "unsupported_policy"
            ? "the stored policy method is unsupported"
            : params.evaluation === "experiment_not_found"
              ? "the experiment was not found"
              : params.evaluation ===
                  "precomputed_ctr_policy_must_precede_visits"
                ? "this test already has visits; create a fresh private test and declare a policy before its first visit"
                : null
  const [ctrIndex, ctrRead] = id
    ? await Promise.all([
        loadPrivatePrecomputedCtrIndex(prisma, {
          experimentId: id,
          reviewer: principal,
        }),
        loadPrivatePrecomputedCtrReport(prisma, {
          experimentId: id,
          revision: requestedRevision,
          reviewer: principal,
        }),
      ])
    : ([null, null] as const)

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
      <PrivateVisitDiagnosticsView report={report} clicks={clicks} />
      {id && ctrRead ? (
        <PrivateCtrReportView
          experimentId={id}
          policyDeclared={ctrIndex?.policyDeclared ?? false}
          canDeclarePolicy={ctrIndex?.canDeclarePolicy ?? false}
          declarationUnavailableReason={
            ctrIndex?.declarationUnavailableReason ?? null
          }
          canOperate={hasPermission(
            principal,
            "operate:recommendation-experiments",
          )}
          read={ctrRead}
          revisions={ctrIndex?.revisions ?? []}
          evaluationMessage={evaluationMessage}
        />
      ) : null}
    </div>
  )
}
