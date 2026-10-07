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
  const [launchCapacityJson, setLaunchCapacityJson] = useState("")
  const [livePolicyJson, setLivePolicyJson] = useState("")
  const [livePolicyDigest, setLivePolicyDigest] = useState("")
  const [liveAgreement, setLiveAgreement] = useState("")
  const [liveStartsAt, setLiveStartsAt] = useState(
    new Date(
      (Math.floor(Date.now() / 3_600_000) + 1) * 3_600_000,
    ).toISOString(),
  )
  const liveEndsAt = Number.isFinite(new Date(liveStartsAt).getTime())
    ? oneUtcCalendarMonthAfter(new Date(liveStartsAt)).toISOString()
    : "Invalid start time"
  const selectedGeneration = readiness.generations.find(
    (item) => item.id === generationId,
  )
  const control = readiness.control
  const pendingManualReview = control.pendingManualReview
  const pendingManualReviewIsLive = Boolean(
    readiness.experiments.find(
      (item) => item.id === pendingManualReview?.experimentId,
    )?.liveEvidence,
  )
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
        reasons?: string[]
        policyDigest?: string
      }
      if (!response.ok || !result.ok) {
        setMessage(
          [
            result.error ?? "operation_unavailable",
            ...(result.reasons ?? []),
          ].join(": "),
        )
        return
      }
      if (input.action === "policy_digest" && result.policyDigest) {
        setLivePolicyDigest(result.policyDigest)
        setMessage(
          `Policy preview digest: ${result.policyDigest}. This does not approve the policy.`,
        )
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
      <PageSection
        title="Launch capacity attestation"
        meta="SEPARATE FROM BUILD / DEFAULT OFF"
      >
        <div className="space-y-3 p-4 text-[13px]">
          <p>
            Refresh physical headroom for the completed generation after the
            verified baseline is final. This appends a launch receipt and leaves
            the build and serving pointer untouched. The PostgreSQL cluster,
            database size, retained-visit sample, active build reservations, and
            five-gigabyte reserve are checked by Admin.
          </p>
          {readiness.launchCapacityReceipt ? (
            <p className="break-all">
              Latest receipt: {readiness.launchCapacityReceipt.status} ·{" "}
              {readiness.launchCapacityReceipt.id} · measured{" "}
              {readiness.launchCapacityReceipt.measuredAt.toISOString()} ·
              digest {readiness.launchCapacityReceipt.receiptDigest} · projected{" "}
              {readiness.launchCapacityReceipt.projectedBytes} bytes · after
              reserve{" "}
              {readiness.launchCapacityReceipt.availableAfterReserveBytes}{" "}
              bytes.
            </p>
          ) : (
            <p>No launch capacity receipt has been recorded.</p>
          )}
          {readiness.baselineCapacitySample ? (
            <p>
              Final baseline: {readiness.baselineCapacitySample.verifiedVisits}{" "}
              verified visits. The two thin baseline tables occupy{" "}
              {readiness.baselineCapacitySample.physicalVisitBytes} bytes; this
              is only a lower bound. Admin also measures all recommendation
              requests in the baseline window, including failed and excluded
              attempts, plus their retained child rows. Physical overhead, WAL,
              future demand, and A/B visit growth are projection assumptions. A
              thin-table-only sample is rejected.
            </p>
          ) : null}
          {canOperate && selectedGeneration ? (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault()
                try {
                  void post({
                    action: "attest_launch_capacity",
                    generationId,
                    measurement: JSON.parse(launchCapacityJson),
                  })
                } catch {
                  setMessage("invalid_launch_capacity_measurement_json")
                }
              }}
            >
              <label className="block">
                Externally observed capacity measurement JSON
                <textarea
                  value={launchCapacityJson}
                  onChange={(event) =>
                    setLaunchCapacityJson(event.target.value)
                  }
                  rows={9}
                  placeholder='{"measuredAt":"...","clusterSystemId":"...","observedDbBytes":0,"availableBytes":0,"reserveBytes":5000000000,"projectedBytes":0,"sampleSourceCount":0,"sampleBytes":0,"source":"operator_verified_pgdata_df"}'
                  className="mt-1 w-full border border-[var(--color-hairline)] bg-transparent p-2 font-mono"
                />
              </label>
              <button
                type="submit"
                disabled={busy || !launchCapacityJson.trim()}
                className="border border-[var(--color-hairline)] px-3 py-2 disabled:opacity-50"
              >
                Record launch capacity receipt
              </button>
            </form>
          ) : null}
        </div>
      </PageSection>
      {canOperate && readiness.incumbentRouting && selectedGeneration ? (
        <PageSection
          title="Prepare a verified live cohort"
          meta="EXPLICIT AGREEMENT / NO SERVING CHANGE"
        >
          <form
            className="grid gap-3 p-4 text-[13px] md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault()
              try {
                if (
                  liveAgreement !== "prelaunch_agreed" ||
                  !livePolicyDigest ||
                  !readiness.baseline?.finalReportDigest ||
                  !readiness.launchCapacityReceipt?.receiptDigest
                )
                  throw new Error("agreement_or_evidence_missing")
                void post({
                  action: "prepare",
                  experimentId: `public-watch-${crypto.randomUUID()}`,
                  generationId,
                  startsAt: liveStartsAt,
                  endsAt: liveEndsAt,
                  expectedControlRoutingDigest:
                    readiness.incumbentRouting!.routingDigest,
                  expectedSourceSetDigest: selectedGeneration.sourceSetDigest,
                  policySettings: JSON.parse(livePolicyJson),
                  authority: "live_verified",
                  policyAgreement: {
                    authority: "prelaunch_agreed",
                    settingsDigest: livePolicyDigest,
                    baselineReportDigest: readiness.baseline.finalReportDigest,
                    launchCapacityReceiptDigest:
                      readiness.launchCapacityReceipt.receiptDigest,
                  },
                })
              } catch {
                setMessage("live_policy_agreement_or_evidence_missing")
              }
            }}
          >
            <p className="md:col-span-2">
              Enter owner-agreed numeric settings. No live policy has been
              approved by this page. Previewing a digest only checks the
              settings; preparation requires the final verified baseline and a
              fresh capacity receipt. Starting traffic is a separate action.
            </p>
            <label className="md:col-span-2">
              Agreed stopping policy JSON
              <textarea
                value={livePolicyJson}
                onChange={(event) => {
                  setLivePolicyJson(event.target.value)
                  setLivePolicyDigest("")
                }}
                rows={12}
                className="mt-1 w-full border border-[var(--color-hairline)] bg-transparent p-2 font-mono"
              />
            </label>
            <button
              type="button"
              disabled={busy || !livePolicyJson.trim()}
              onClick={() => {
                try {
                  void post({
                    action: "policy_digest",
                    policySettings: JSON.parse(livePolicyJson),
                  })
                } catch {
                  setMessage("invalid_live_policy_json")
                }
              }}
              className="border border-[var(--color-hairline)] px-3 py-2 disabled:opacity-50"
            >
              Preview policy digest
            </button>
            <p className="self-center break-all">
              {livePolicyDigest || "No policy digest previewed"}
            </p>
            <label>
              Cohort start (full UTC hour)
              <input
                value={liveStartsAt}
                onChange={(event) => setLiveStartsAt(event.target.value)}
                className="mt-1 w-full border border-[var(--color-hairline)] bg-transparent p-2"
              />
            </label>
            <p className="self-end break-all">End: {liveEndsAt}</p>
            <p className="md:col-span-2 break-all">
              Baseline digest:{" "}
              {readiness.baseline?.finalReportDigest ?? "missing"}. Capacity
              digest:{" "}
              {readiness.launchCapacityReceipt?.receiptDigest ?? "missing"}.
            </p>
            <label className="md:col-span-2">
              After the owner agrees the exact numeric policy, type
              prelaunch_agreed
              <input
                value={liveAgreement}
                onChange={(event) => setLiveAgreement(event.target.value)}
                className="mt-1 w-full border border-[var(--color-hairline)] bg-transparent p-2"
              />
            </label>
            <button
              type="submit"
              disabled={
                busy ||
                liveAgreement !== "prelaunch_agreed" ||
                !livePolicyDigest
              }
              className="border border-[var(--color-hairline)] px-3 py-2 disabled:opacity-50"
            >
              Prepare live cohort
            </button>
          </form>
        </PageSection>
      ) : null}
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
              {pendingManualReviewIsLive
                ? " Current Web counters cannot prove experiment-scoped visit and click completeness, so a live result remains inconclusive and cannot be promoted."
                : ""}
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
                            {result.evidenceBasis === "live_incomplete" ? (
                              <p>
                                This live cohort cannot certify a winner:
                                browser or network events that never reached Web
                                remain unverified, even when server-observed
                                requests reconcile.
                              </p>
                            ) : null}
                            {result.liveLaunchEvidence ? (
                              <p className="break-all">
                                Frozen live evidence:{" "}
                                {result.liveLaunchEvidence.evidenceDigest};
                                baseline{" "}
                                {result.liveLaunchEvidence.baselineReportDigest}
                                ; capacity{" "}
                                {
                                  result.liveLaunchEvidence
                                    .launchCapacityReceiptDigest
                                }
                                ; catalog{" "}
                                {
                                  result.liveLaunchEvidence
                                    .authoritativeCatalogSourceSetDigest
                                }
                                .
                              </p>
                            ) : null}
                            <p>
                              Web/edge bot exclusion coverage:{" "}
                              {result.measurementHealth
                                .edgeAutomationCoverage ?? "unverified"}
                              .
                            </p>
                            {result.measurementHealth.webRequestHealth ? (
                              <p>
                                Web request reconciliation:{" "}
                                {
                                  result.measurementHealth.webRequestHealth
                                    .status
                                }
                                ;{" "}
                                {
                                  result.measurementHealth.webRequestHealth
                                    .missingHourCount
                                }{" "}
                                missing hours,{" "}
                                {
                                  result.measurementHealth.webRequestHealth
                                    .imbalancedHourCount
                                }{" "}
                                imbalanced hours. These counters describe
                                observed server requests; end-to-end client
                                event completeness remains unverified.
                              </p>
                            ) : null}
                            {result.measurementHealth
                              .experimentRequestHealth ? (
                              <p>
                                Experiment-scoped Web requests:{" "}
                                {
                                  result.measurementHealth
                                    .experimentRequestHealth.reconciliation
                                }
                                ;{" "}
                                {
                                  result.measurementHealth
                                    .experimentRequestHealth
                                    .attributedDeliveryAttempts
                                }{" "}
                                attributed delivery attempts,{" "}
                                {
                                  result.measurementHealth
                                    .experimentRequestHealth
                                    .acceptedVisitAttempts
                                }{" "}
                                accepted visit attempts,{" "}
                                {
                                  result.measurementHealth
                                    .experimentRequestHealth
                                    .clickAcknowledgements
                                }{" "}
                                click acknowledgements, and{" "}
                                {
                                  result.measurementHealth
                                    .experimentRequestHealth.clickUnavailable
                                }{" "}
                                server-observed click failures. Retries can
                                exceed distinct visits and clicks.{" "}
                                {
                                  result.measurementHealth
                                    .experimentRequestHealth.missingHourCount
                                }{" "}
                                hours lack a scoped observation.
                              </p>
                            ) : null}
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
                        {canOperate &&
                        item.liveEvidence &&
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
                                authority: "live_verified",
                              })
                            }
                            className="underline disabled:opacity-50"
                          >
                            Start verified A/B
                          </button>
                        ) : null}
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
                        {canOperate &&
                        (fixture || item.liveEvidence) &&
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
