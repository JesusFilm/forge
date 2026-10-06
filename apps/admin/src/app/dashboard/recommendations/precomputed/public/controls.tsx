"use client"

import { useState } from "react"
import { PageSection, StatusPill } from "@/components/admin-ui"
import type { PrecomputedCtrReport } from "@/services/recommendations/precomputed/ctr-report"
import type { loadPrecomputedPublicReadiness } from "@/services/recommendations/precomputed/public-readiness"
import { oneUtcCalendarMonthAfter } from "@/services/recommendations/precomputed/cohort-window"

type Readiness = Awaited<ReturnType<typeof loadPrecomputedPublicReadiness>>

const policyTemplate = {
  baselineHumanVisitCtr: 0.04,
  minimumDetectableAbsoluteUplift: 0.02,
  minimumPracticalAbsoluteUplift: 0.01,
  plannedPower: 0.8,
  minimumEligibleVisitsPerArm: 100,
  minimumIndependentBrowsersPerArm: 100,
  minimumDurationHours: 168,
  lateEventCutoffHours: 48,
  maximumActualFallbackRate: 0.05,
  maximumUnlinkedDeliveryRate: 0.01,
}

function reportView(value: unknown): PrecomputedCtrReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const candidate = value as Partial<PrecomputedCtrReport>
  return typeof candidate.outcome === "string" &&
    Array.isArray(candidate.reasons) &&
    candidate.byArm?.control &&
    candidate.byArm?.challenger &&
    candidate.measurementHealth
    ? (candidate as PrecomputedCtrReport)
    : null
}

export function PublicPrecomputedControls({
  readiness,
  canOperate,
  canRollback,
}: {
  readiness: Readiness
  canOperate: boolean
  canRollback: boolean
}) {
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [generationId, setGenerationId] = useState(
    readiness.generations[0]?.id ?? "",
  )
  const [startsAt, setStartsAt] = useState(
    new Date(Date.now() - 60_000).toISOString(),
  )
  const endsAt = Number.isFinite(new Date(startsAt).getTime())
    ? oneUtcCalendarMonthAfter(new Date(startsAt)).toISOString()
    : "Invalid start time"
  const [policyJson, setPolicyJson] = useState(
    JSON.stringify(policyTemplate, null, 2),
  )
  const selectedGeneration = readiness.generations.find(
    (item) => item.id === generationId,
  )
  const control = readiness.control
  const pendingManualReview = control.pendingManualReview
  const selectedExperimentId =
    control.experimentId ?? pendingManualReview?.experimentId
  const fixture = readiness.fixtureRehearsalEnvironment
  const retained = readiness.experiments.find(
    (item) => item.id === control.retainedExperimentId,
  )

  async function post(input: Record<string, unknown>) {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(
        "/api/recommendations/precomputed/public-control",
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "x-forge-csrf": "precomputed-public-control-v1",
          },
          body: JSON.stringify(input),
        },
      )
      const result = (await response.json()) as {
        ok?: boolean
        error?: string
      }
      if (!response.ok || !result.ok) {
        setMessage(result.error ?? "operation_unavailable")
        return
      }
      window.location.reload()
    } catch {
      setMessage("operation_unavailable_reconcile_current_control")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageSection
        title="Verified incumbent baseline"
        meta="DEFAULT OFF / INCUMBENT ONLY"
      >
        <div className="space-y-3 p-4 text-[13px]">
          <p>
            This seven-day baseline verifies real browsers and records incumbent
            Watch visits and clicks. It schedules on the next full UTC hour and
            does not expose saved recommendations or enroll an A/B cohort.
          </p>
          {readiness.baseline ? (
            <>
              <p className="break-all">
                <StatusPill
                  tone={
                    readiness.baseline.status === "active"
                      ? "success"
                      : "warning"
                  }
                >
                  {readiness.baseline.status}
                </StatusPill>{" "}
                {readiness.baseline.id} · {readiness.baseline.startsAt} to{" "}
                {readiness.baseline.endsAt}
              </p>
              {readiness.baselineReport ? (
                <p>
                  Verified incumbent visit CTR:{" "}
                  {readiness.baselineReport.clickedVisits}/
                  {readiness.baselineReport.eligibleVisits} visits
                  {readiness.baselineReport.visitCtr === null
                    ? ""
                    : ` (${(100 * readiness.baselineReport.visitCtr).toFixed(2)}%)`}
                  ; {readiness.baselineReport.independentBrowsers} independent
                  browsers.{" "}
                  {readiness.baselineReport.isFinal
                    ? "Final DB evidence."
                    : "Provisional DB evidence."}{" "}
                  Evidence basis: {readiness.baselineReport.evidenceBasis}. An
                  isolated fixture cannot satisfy live launch readiness.
                </p>
              ) : null}
              <p>
                Web request health:{" "}
                {readiness.baselineWebMeasurement === null
                  ? "No completed baseline hours yet"
                  : readiness.baselineWebMeasurement.status === "unavailable"
                    ? readiness.baselineWebMeasurement.reason
                    : `${readiness.baselineWebMeasurement.status}; ${readiness.baselineWebMeasurement.coveredHours}/${readiness.baselineWebMeasurement.requestedHours} hours observed; ${readiness.baselineWebMeasurement.missingHours.length} missing hours; ${readiness.baselineWebMeasurement.imbalancedHours.length} counter imbalances; ${readiness.baselineWebMeasurement.counters.delivery_qualified} qualified Web request attempts`}
                . These are request attempts, not distinct visits or clicks.
                {!readiness.baselineFullHourWindow
                  ? " The full baseline window has not ended on a completed UTC-hour boundary."
                  : ""}
                {readiness.baselineRequestToVisitGap
                  ? " Qualified Web requests are fewer than durable eligible visits; inspect tracking loss."
                  : ""}
              </p>
              {readiness.baselineWebMeasurement &&
              readiness.baselineWebMeasurement.status !== "unavailable" ? (
                <p>
                  Web request diagnostics: excluded{" "}
                  {readiness.baselineWebMeasurement.counters.delivery_excluded},
                  unknown{" "}
                  {readiness.baselineWebMeasurement.counters.delivery_unknown},
                  missing browser identity{" "}
                  {
                    readiness.baselineWebMeasurement.counters
                      .delivery_missing_identity
                  }
                  , verification unavailable{" "}
                  {
                    readiness.baselineWebMeasurement.counters
                      .delivery_verification_unavailable
                  }
                  , click attempts/acknowledgements{" "}
                  {readiness.baselineWebMeasurement.counters.click_attempt}/
                  {readiness.baselineWebMeasurement.counters.click_ack}.
                </p>
              ) : null}
              {canOperate &&
              (readiness.baseline.status === "active" ||
                readiness.baseline.status === "scheduled" ||
                readiness.baseline.status === "ended") ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void post({
                      action: "stop_baseline",
                      baselineId: readiness.baseline!.id,
                    })
                  }
                  className="border border-[var(--color-hairline)] px-3 py-2 disabled:opacity-50"
                >
                  Stop baseline admission
                </button>
              ) : null}
            </>
          ) : (
            <p>No baseline has been started.</p>
          )}
          {canOperate &&
          control.mode === "incumbent" &&
          (!readiness.baseline || readiness.baseline.status === "stopped") ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void post({ action: "start_baseline" })}
              className="border border-[var(--color-hairline)] px-3 py-2 disabled:opacity-50"
            >
              Schedule verified baseline
            </button>
          ) : null}
        </div>
      </PageSection>
      <PageSection title="Serving pointer" meta="MANUAL / VERSIONED">
        <div className="min-w-0 space-y-3 p-4 text-[13px]">
          <p className="break-all">
            <StatusPill
              tone={control.mode === "incumbent" ? "warning" : "success"}
            >
              {control.mode}
            </StatusPill>{" "}
            Version {control.version} · experiment{" "}
            {control.experimentId ?? "none"} · generation{" "}
            {control.generationId ?? "none"}
          </p>
          <p className="break-all">
            Configuration {control.configurationDigest ?? "—"} · report revision{" "}
            {control.reportRevision ?? "—"} · evidence digest{" "}
            {control.reportEvidenceDigest ?? "—"}
          </p>
          {pendingManualReview ? (
            <p role="status" className="break-all">
              A/B serving stopped at {pendingManualReview.endsAt}. Incumbent
              recommendations are serving while experiment{" "}
              {pendingManualReview.experimentId} awaits manual evaluation and a
              decision. No winner is activated automatically.
            </p>
          ) : null}
          {control.retainedExperimentId ? (
            <div className="space-y-2">
              <p className="break-all">
                Retained for review: {control.retainedExperimentId}
              </p>
              {canRollback &&
              retained &&
              retained.expiresAt.getTime() <= Date.now() ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void post({
                      action: "release_retained",
                      expectedControlVersion: control.version,
                      expectedExperimentId: control.retainedExperimentId,
                      reasonCode: "retention_horizon_complete",
                    })
                  }
                  className="border border-[var(--color-hairline)] px-3 py-2 disabled:opacity-50"
                >
                  Release expired rollback pin
                </button>
              ) : null}
            </div>
          ) : null}
          {message ? <p role="alert">{message.replaceAll("_", " ")}</p> : null}
          {canRollback &&
          (control.mode !== "incumbent" || pendingManualReview) ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void post({
                  action: "rollback",
                  expectedControlVersion: control.version,
                  expectedExperimentId: selectedExperimentId,
                  expectedGenerationId:
                    control.generationId ?? pendingManualReview?.generationId,
                  expectedReportRevision: control.reportRevision,
                  expectedReportEvidenceDigest: control.reportEvidenceDigest,
                  reasonCode: "operator_rollback",
                })
              }
              className="border border-[var(--color-hairline)] px-3 py-2 disabled:opacity-50"
            >
              Restore incumbent now
            </button>
          ) : null}
        </div>
      </PageSection>
      <PageSection
        title="Prepared cohorts and evidence"
        meta="READ ONLY UNTIL SELECTED"
      >
        <div className="overflow-x-auto p-4 text-[13px]">
          {readiness.experiments.length ? (
            <table className="w-full min-w-max text-left [&_td]:pr-4 [&_th]:pr-4">
              <thead>
                <tr>
                  <th>Experiment</th>
                  <th>Generation</th>
                  <th>Window</th>
                  <th>Latest result</th>
                  <th>Manual action</th>
                </tr>
              </thead>
              <tbody>
                {readiness.experiments.map((item) => {
                  const report = item.latestReport
                  const result = reportView(report?.result)
                  const selected = selectedExperimentId === item.id
                  const winner =
                    report?.isFinal &&
                    result?.evidenceBasis === "isolated_fixture" &&
                    result.outcome === "challenger" &&
                    result.reasons.length === 0
                  return (
                    <tr
                      key={item.id}
                      className="border-t border-[var(--color-hairline)]"
                    >
                      <td className="py-2">
                        <span className="break-all">{item.id}</span>
                        <div className="text-[11px] text-[var(--color-text-secondary)]">
                          {item.configurationDigest}
                        </div>
                      </td>
                      <td>{item.generationId}</td>
                      <td>
                        {item.startsAt.toISOString()} to{" "}
                        {item.endsAt.toISOString()}
                      </td>
                      <td>
                        {report
                          ? `r${report.revision} ${report.isFinal ? "final" : "provisional"} ${result?.outcome ?? "unavailable"}`
                          : "not evaluated"}
                        {result ? (
                          <details>
                            <summary className="cursor-pointer underline">
                              Review visit CTR and gates
                            </summary>
                            <p>
                              Control: {result.byArm.control.clickedVisits}/
                              {result.byArm.control.eligibleVisits} clicked
                              visits; challenger:{" "}
                              {result.byArm.challenger.clickedVisits}/
                              {result.byArm.challenger.eligibleVisits}.
                            </p>
                            <p>
                              Visit CTR: control{" "}
                              {result.byArm.control.visitCtr == null
                                ? "—"
                                : `${(100 * result.byArm.control.visitCtr).toFixed(2)}%`}
                              ; challenger{" "}
                              {result.byArm.challenger.visitCtr == null
                                ? "—"
                                : `${(100 * result.byArm.challenger.visitCtr).toFixed(2)}%`}
                              .
                            </p>
                            <p>
                              Basis: {result.evidenceBasis ?? "unverified"}.
                            </p>
                            <p>
                              Web/edge bot exclusion coverage:{" "}
                              {result.measurementHealth
                                .edgeAutomationCoverage ?? "unverified"}
                              .
                            </p>
                            <p>
                              Gates:{" "}
                              {result.reasons.length
                                ? result.reasons.join(", ")
                                : "none reported in this revision"}
                              .
                            </p>
                          </details>
                        ) : null}
                      </td>
                      <td className="space-x-2">
                        {fixture &&
                        canOperate &&
                        control.mode === "incumbent" &&
                        !pendingManualReview &&
                        !report ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void post({
                                action: "start",
                                experimentId: item.id,
                                expectedConfigurationDigest:
                                  item.configurationDigest,
                                expectedControlVersion: control.version,
                                authority: "isolated_fixture",
                              })
                            }
                            className="underline disabled:opacity-50"
                          >
                            Start fixture A/B
                          </button>
                        ) : null}
                        {fixture &&
                        canOperate &&
                        selected &&
                        (control.mode === "ab" || pendingManualReview) ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void post({
                                action: "evaluate",
                                experimentId: item.id,
                              })
                            }
                            className="underline disabled:opacity-50"
                          >
                            Save CTR revision
                          </button>
                        ) : null}
                        {fixture &&
                        canOperate &&
                        selected &&
                        (control.mode === "ab" || pendingManualReview) &&
                        winner ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void post({
                                action: "promote",
                                expectedControlVersion: control.version,
                                expectedExperimentId: item.id,
                                expectedGenerationId: item.generationId,
                                expectedReportRevision: report!.revision,
                                expectedReportEvidenceDigest:
                                  report!.evidenceDigest,
                              })
                            }
                            className="underline disabled:opacity-50"
                          >
                            Promote exact fixture result
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <p>No public cohort has been prepared.</p>
          )}
        </div>
      </PageSection>
      {fixture && canOperate && readiness.incumbentRouting ? (
        <PageSection
          title="Prepare an isolated rehearsal"
          meta="NO SERVING CHANGE"
        >
          <form
            className="grid gap-3 p-4 text-[13px] md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault()
              try {
                if (!selectedGeneration) throw new Error("select_generation")
                void post({
                  action: "prepare",
                  experimentId: `public-watch-${crypto.randomUUID()}`,
                  generationId,
                  startsAt,
                  endsAt,
                  expectedControlRoutingDigest:
                    readiness.incumbentRouting!.routingDigest,
                  expectedSourceSetDigest: selectedGeneration.sourceSetDigest,
                  policySettings: JSON.parse(policyJson),
                  authority: "isolated_fixture",
                })
              } catch {
                setMessage("invalid_fixture_policy_or_generation")
              }
            }}
          >
            <label>
              Complete generation
              <select
                value={generationId}
                onChange={(event) => setGenerationId(event.target.value)}
                className="mt-1 block w-full border border-[var(--color-hairline)] bg-transparent p-2"
              >
                {readiness.generations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.id} · {item.expectedSourceCount} sources
                  </option>
                ))}
              </select>
            </label>
            <p className="self-end break-all">
              Frozen incumbent routing:{" "}
              {readiness.incumbentRouting.routingDigest}
            </p>
            <label>
              Starts at (ISO with offset)
              <input
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
                className="mt-1 block w-full border border-[var(--color-hairline)] bg-transparent p-2"
              />
            </label>
            <label>
              Ends at (one UTC calendar month later)
              <input
                value={endsAt}
                readOnly
                className="mt-1 block w-full border border-[var(--color-hairline)] bg-transparent p-2"
              />
            </label>
            <label className="md:col-span-2">
              Fixture stopping policy JSON
              <textarea
                value={policyJson}
                onChange={(event) => setPolicyJson(event.target.value)}
                rows={12}
                className="mt-1 block w-full border border-[var(--color-hairline)] bg-transparent p-2 font-mono"
              />
            </label>
            <button
              type="submit"
              disabled={busy || !selectedGeneration}
              className="w-fit border border-[var(--color-hairline)] px-3 py-2 disabled:opacity-50"
            >
              Prepare cohort without serving
            </button>
          </form>
        </PageSection>
      ) : null}
    </>
  )
}
