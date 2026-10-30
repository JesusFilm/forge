import type { PrecomputedEngagementReport } from "@/services/recommendations/precomputed/engagement-report"

type ComparisonInput = {
  byArm: Record<"control" | "challenger", { visitCtr: number | null }>
  engagement?: PrecomputedEngagementReport
}

const percent = (value: number | null) =>
  value == null ? "Not available" : `${(100 * value).toFixed(2)}%`
const number = (value: number | null) =>
  value == null ? "Not available" : value.toFixed(2)

/** Shared by public controls and saved private report revisions. */
export function EngagementComparison({ report }: { report: ComparisonInput }) {
  const engagement = report.engagement
  const rows = [
    [
      "Visit CTR",
      percent(report.byArm.control.visitCtr),
      percent(report.byArm.challenger.visitCtr),
    ],
    [
      "Engaged-view rate",
      percent(engagement?.byArm.control.engagedViewRate ?? null),
      percent(engagement?.byArm.challenger.engagedViewRate ?? null),
    ],
    [
      "Active watch minutes / 100 eligible visits",
      number(engagement?.byArm.control.activeWatchMinutesPer100Visits ?? null),
      number(
        engagement?.byArm.challenger.activeWatchMinutesPer100Visits ?? null,
      ),
    ],
    [
      "Clicks linked to claimed playback",
      percent(engagement?.byArm.control.playbackClaimRate ?? null),
      percent(engagement?.byArm.challenger.playbackClaimRate ?? null),
    ],
    [
      "Claimed playbacks with active-time evidence",
      percent(engagement?.byArm.control.activeCoverageRate ?? null),
      percent(engagement?.byArm.challenger.activeCoverageRate ?? null),
    ],
  ]
  const interval = engagement?.engagedViewUncertainty
  return (
    <div className="my-3 space-y-3 text-[13px]">
      <div className="overflow-x-auto">
        <table
          aria-label="CTR and playback engagement comparison"
          className="w-full text-left"
        >
          <thead>
            <tr className="border-b border-[var(--color-hairline)]">
              <th scope="col" className="py-2 pr-4 font-medium">
                Measure
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Current
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Saved
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, control, challenger]) => (
              <tr
                key={label}
                className="border-b border-[var(--color-hairline)]"
              >
                <th scope="row" className="py-2 pr-4 font-normal">
                  {label}
                </th>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {control}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {challenger}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {engagement ? (
        <>
          <p className="text-[var(--color-text-secondary)]">
            An engaged visit leads to at least one recommended video watched
            actively for 30 seconds or 25% of its duration. All eligible visits,
            including empty deliveries, remain in the denominator.
          </p>
          <p>
            Engaged-view uplift (saved minus current):{" "}
            {interval?.difference == null
              ? "Not available"
              : `${(100 * interval.difference).toFixed(2)} percentage points`}
            . 95% browser-clustered interval:{" "}
            {interval?.lowerBound == null || interval.upperBound == null
              ? "Not enough data"
              : `${(100 * interval.lowerBound).toFixed(2)} to ${(100 * interval.upperBound).toFixed(2)} percentage points`}
            .
          </p>
          <details>
            <summary className="cursor-pointer underline underline-offset-4">
              Playback capture details
            </summary>
            {(["control", "challenger"] as const).map((arm) => {
              const value = engagement.byArm[arm]
              return (
                <p key={arm} className="mt-2">
                  {arm === "control" ? "Current" : "Saved"}:{" "}
                  {value.engagedVisits} engaged visits; {value.claimedPlaybacks}{" "}
                  claimed playbacks; {value.completePlaybacks} complete and{" "}
                  {value.partialPlaybacks} partial capture;{" "}
                  {value.missingOutcomePlaybacks} missing outcomes;{" "}
                  {value.missingCoveragePlaybacks} without active-time evidence;{" "}
                  {value.pendingPlaybacks} still pending;{" "}
                  {value.invalidPlaybacks} invalid.{" "}
                  {value.unmeasuredArchivedVisits} older visits with unavailable
                  engagement.
                </p>
              )
            })}
          </details>
          <p className="text-[var(--color-text-secondary)]">
            Observed engagement is a secondary comparison alongside the frozen
            CTR result. Partial capture can undercount viewing; compare coverage
            in both variants. Unlinked clicks may mean the viewer left or
            playback tracking did not arrive. Pending outcomes can change later.
          </p>
        </>
      ) : (
        <p className="text-[var(--color-text-secondary)]">
          Engagement was not included in this saved revision. Save a new report
          revision to include available playback evidence.
        </p>
      )}
    </div>
  )
}
