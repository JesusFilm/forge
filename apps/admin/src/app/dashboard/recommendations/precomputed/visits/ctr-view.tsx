import Link from "next/link"
import { PageSection, StatusPill } from "@/components/admin-ui"
import type { PrecomputedCtrRead } from "@/services/recommendations/precomputed/ctr-report"
import {
  createFixturePrecomputedCtrPolicy,
  evaluatePrivateCtr,
} from "./actions"

type Revision = { revision: number; isFinal: boolean; asOf: Date }

function percent(value: number | null) {
  return value == null ? "—" : `${(100 * value).toFixed(2)}%`
}

function signedPercent(value: number | null) {
  return value == null
    ? "—"
    : `${value >= 0 ? "+" : ""}${(100 * value).toFixed(2)} pp`
}

const fixtureFields = [
  ["baselineHumanVisitCtr", "Fixture baseline visit CTR", "0.04", "0.001"],
  [
    "minimumDetectableAbsoluteUplift",
    "Detectable absolute uplift",
    "0.02",
    "0.001",
  ],
  [
    "minimumPracticalAbsoluteUplift",
    "Practical absolute uplift",
    "0.01",
    "0.001",
  ],
  ["plannedPower", "Planned power", "0.8", "0.01"],
  ["minimumEligibleVisitsPerArm", "Minimum visits per arm", "100", "1"],
  ["minimumIndependentBrowsersPerArm", "Minimum browsers per arm", "100", "1"],
  ["minimumDurationHours", "Minimum duration (hours)", "168", "1"],
  ["lateEventCutoffHours", "Late-event cutoff (hours)", "48", "1"],
  [
    "maximumActualFallbackRate",
    "Maximum actual fallback rate",
    "0.05",
    "0.001",
  ],
  [
    "maximumUnlinkedDeliveryRate",
    "Maximum unlinked delivery rate",
    "0.01",
    "0.001",
  ],
] as const

export function PrivateCtrReportView({
  experimentId,
  policyDeclared,
  canDeclarePolicy,
  declarationUnavailableReason,
  canOperate,
  read,
  revisions,
  evaluationMessage,
}: {
  experimentId: string
  policyDeclared: boolean
  canDeclarePolicy: boolean
  declarationUnavailableReason: "visits_exist" | "experiment_unavailable" | null
  canOperate: boolean
  read: PrecomputedCtrRead
  revisions: Revision[]
  evaluationMessage: string | null
}) {
  const report = read.status === "available" ? read.report : null
  return (
    <>
      <PageSection title="CTR decision report" meta="PRIVATE / NO ACTIVATION">
        <div className="space-y-3 p-4 text-[13px]">
          <p>
            Primary: eligible Watch visits with an accepted recommendation
            click, divided by all eligible Watch visits. Empty and failed
            results stay in the assigned arm. These private observations cannot
            certify a winner: human/bot qualification is unverified, browser
            event loss is unobservable, and fixture numbers are not an agreed
            launch policy.
          </p>
          {evaluationMessage ? (
            <p
              role="alert"
              className="border border-[var(--color-hairline)] p-3"
            >
              No new revision was saved: {evaluationMessage}.
            </p>
          ) : null}
          {report ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone="warning">{report.outcome}</StatusPill>
                <span>
                  Revision {report.revision} ·{" "}
                  {report.isFinal ? "final" : "provisional"} · as of{" "}
                  {report.asOf}
                </span>
              </div>
              <p className="break-all">
                Generation <code>{report.generationId}</code> · control manifest{" "}
                <code>{report.controlManifestId}</code>
              </p>
              <p>
                Frozen cohort {report.cohort.startsAt} to {report.cohort.endsAt}
                ; fixed-horizon decision after {report.cohort.finalAt}.
              </p>
              <p>
                Policy <code>{report.policy.version}</code> · authority{" "}
                {report.policy.authority.replaceAll("_", " ")} · digest{" "}
                <code className="break-all">{report.policy.digest}</code>
              </p>
              <p className="break-all">
                Source set <code>{report.sourceSetDigest}</code> · routing{" "}
                <code>{report.controlRoutingDigest}</code> · configuration{" "}
                <code>{report.configurationDigest}</code>
              </p>
            </>
          ) : (
            <p>
              Report unavailable:{" "}
              {read.status === "unavailable"
                ? read.reason.replaceAll("_", " ")
                : "unknown"}
              .
            </p>
          )}
          {revisions.length ? (
            <div
              className="flex flex-wrap gap-3"
              aria-label="CTR report revisions"
            >
              {revisions.map((item) => (
                <Link
                  key={item.revision}
                  className="underline underline-offset-4"
                  href={`/dashboard/recommendations/precomputed/visits?experiment=${encodeURIComponent(experimentId)}&revision=${item.revision}`}
                >
                  Revision {item.revision}
                  {item.isFinal ? " (final)" : ""}
                </Link>
              ))}
            </div>
          ) : null}
          {canOperate && policyDeclared ? (
            <form action={evaluatePrivateCtr}>
              <input type="hidden" name="experimentId" value={experimentId} />
              <button
                type="submit"
                className="border border-[var(--color-hairline)] px-3 py-2"
              >
                Save evaluation revision
              </button>
            </form>
          ) : null}
        </div>
      </PageSection>
      {report ? (
        <>
          <PageSection title="Visit and card click rates" meta="ASSIGNED ARMS">
            <div className="overflow-x-auto p-4 text-[13px]">
              <table className="w-full min-w-max text-left [&_td]:pr-4 [&_th]:pr-4">
                <thead>
                  <tr>
                    <th>Arm</th>
                    <th>Eligible visits</th>
                    <th>Clicked visits</th>
                    <th>Visit CTR</th>
                    <th>Qualified impressions</th>
                    <th>Matched selections</th>
                    <th>Card CTR</th>
                    <th>Browsers</th>
                    <th>Effective browsers</th>
                  </tr>
                </thead>
                <tbody>
                  {(["control", "challenger"] as const).map((arm) => {
                    const row = report.byArm[arm]
                    return (
                      <tr
                        key={arm}
                        className="border-t border-[var(--color-hairline)]"
                      >
                        <th className="py-2">{arm}</th>
                        <td>{row.eligibleVisits}</td>
                        <td>{row.clickedVisits}</td>
                        <td>{percent(row.visitCtr)}</td>
                        <td>{row.qualifiedImpressions}</td>
                        <td>{row.matchedSelections}</td>
                        <td>{percent(row.cardCtr)}</td>
                        <td>{row.independentBrowsers}</td>
                        <td>{row.effectiveBrowsers?.toFixed(1) ?? "—"}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="mt-3">
                Challenger minus control:{" "}
                {signedPercent(report.uncertainty.difference)}; 95%
                cluster-based interval{" "}
                {signedPercent(report.uncertainty.lowerBound)} to{" "}
                {signedPercent(report.uncertainty.upperBound)}. This interval
                uses a conservative tabulated t critical value, not an exact
                small-sample coverage guarantee.
              </p>
            </div>
          </PageSection>
          <PageSection
            title="Delivery and measurement health"
            meta="DECISION GATES"
          >
            <div className="overflow-x-auto p-4 text-[13px]">
              <table className="w-full min-w-max text-left [&_td]:pr-4 [&_th]:pr-4">
                <thead>
                  <tr>
                    <th>Arm</th>
                    <th>Served</th>
                    <th>Empty</th>
                    <th>Unavailable</th>
                    <th>Not attempted</th>
                    <th>Actual fallback</th>
                    <th>Fallback rate</th>
                    <th>Recovery attempts</th>
                    <th>Unlinked deliveries</th>
                  </tr>
                </thead>
                <tbody>
                  {(["control", "challenger"] as const).map((arm) => {
                    const row = report.byArm[arm]
                    return (
                      <tr
                        key={arm}
                        className="border-t border-[var(--color-hairline)]"
                      >
                        <th className="py-2">{arm}</th>
                        <td>{row.servedVisits}</td>
                        <td>{row.emptyVisits}</td>
                        <td>{row.unavailableVisits}</td>
                        <td>{row.notAttemptedVisits}</td>
                        <td>{row.actualFallbackVisits}</td>
                        <td>{percent(row.actualFallbackRate)}</td>
                        <td>{row.privateRecoveryAttemptVisits}</td>
                        <td>{row.unlinkedDeliveredVisits}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="mt-3">
                Excluded: {report.exclusions.automation} automation,{" "}
                {report.exclusions.preview} preview, {report.exclusions.unknown}{" "}
                unknown, {report.exclusions.outsideCohort} outside cohort,{" "}
                {report.exclusions.other} other. Archived without policy:{" "}
                {report.measurementHealth.unversionedArchivedVisits}.
              </p>
              <p className="mt-2">
                Decision reasons: {report.reasons.join(", ") || "none"}.
              </p>
            </div>
          </PageSection>
        </>
      ) : null}
      {canOperate && !policyDeclared ? (
        <PageSection title="Declare fixture policy" meta="BEFORE FIRST VISIT">
          <div className="space-y-3 p-4 text-[13px]">
            <p>
              These explicit numbers support a private test only. A measured
              human baseline and agreed stopping thresholds are still required
              before a live A/B test. Once declared, this policy is immutable.
            </p>
            {canDeclarePolicy ? (
              <form
                action={createFixturePrecomputedCtrPolicy}
                className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
              >
                <input type="hidden" name="experimentId" value={experimentId} />
                {fixtureFields.map(([name, label, placeholder, step]) => (
                  <label key={name} className="block">
                    {label}
                    <input
                      name={name}
                      type="number"
                      step={step}
                      placeholder={placeholder}
                      required
                      className="mt-1 block w-full border border-[var(--color-hairline)] bg-transparent p-2"
                    />
                  </label>
                ))}
                <button
                  type="submit"
                  className="self-end border border-[var(--color-hairline)] px-3 py-2"
                >
                  Save immutable fixture policy
                </button>
              </form>
            ) : (
              <p role="status">
                {declarationUnavailableReason === "visits_exist"
                  ? "This test already has retained or archived visits, so a policy cannot be declared retroactively."
                  : "This test is missing or no longer open for private testing."}{" "}
                Create a fresh private test and declare its fixture policy
                before its first visit.
              </p>
            )}
          </div>
        </PageSection>
      ) : null}
    </>
  )
}
