"use client"

import { useState } from "react"

type Study = {
  experimentId: string
  protocolDigest: string
  protocol: Record<string, unknown>
  activatedAt: string | null
  activationId: string | null
  enrolledCount: number
  privacyRevision: number
  evidence: {
    id: string
    kind: string
    reviewedAt: string
    payload: { validUntil: string }
  }[]
  evaluations: {
    evaluationId: string
    result: { decision: string; reasonCodes?: string[] }
    privacyRevision: number
    expiresAt: string
    evaluation: { runId: string }
  }[]
}
type Status = {
  operation?: {
    evidence: { id: string } | null
    evaluation: { evaluationId: string } | null
  } | null
  studies: Study[]
  pointer: {
    generation: number
    stage: string
    killSwitchEnabled: boolean
  } | null
  manifests: { id: string; digest: string }[]
}
const button =
  "rounded-sm border border-[var(--color-hairline)] px-3 py-2 text-[12px] disabled:opacity-50"
const inputClass =
  "block w-full rounded-sm border border-[var(--color-hairline)] bg-transparent p-2 text-[12px]"

/** Loads evidence only on operator request; no page-load requests or polling. */
export function StudyControls() {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [selected, setSelected] = useState("")
  const [protocol, setProtocol] = useState("")
  const [evidence, setEvidence] = useState("")
  const [busy, setBusy] = useState(false)
  const [unknown, setUnknown] = useState<{
    action: string
    id: string
    studyId: string
    protocol?: unknown
    payload: Record<string, unknown>
  } | null>(null)
  const [message, setMessage] = useState(
    "Prepare, review, and activate an immutable bounded study. Calibration never proves usefulness.",
  )
  const study = status?.studies.find((s) => s.experimentId === selected)
  const disabled = busy || unknown !== null

  async function refresh(pending = unknown) {
    setBusy(true)
    try {
      const query = pending
        ? `?studyId=${encodeURIComponent(pending.studyId)}&operationId=${pending.id}`
        : ""
      const response = await fetch(`/api/recommendations/studies${query}`, {
        credentials: "same-origin",
        cache: "no-store",
      })
      if (!response.ok) throw new Error("status unavailable")
      const result: Status = await response.json()
      setStatus(result)
      if (pending) {
        const found = result.studies.find(
          (s) => s.experimentId === pending.studyId,
        )
        const reconciled =
          found &&
          ((pending.action === "prepare" &&
            canonical(found.protocol) === canonical(pending.protocol)) ||
            (pending.action === "activate" &&
              found.activationId === pending.id) ||
            (pending.action === "evidence" &&
              (result.operation?.evidence?.id === pending.id ||
                found.evidence.some((e) => e.id === pending.id))) ||
            (pending.action === "evaluate" &&
              (!!result.operation?.evaluation ||
                found.evaluations.some(
                  (e) => e.evaluation.runId === pending.id,
                ))))
        if (reconciled) {
          setUnknown(null)
          setMessage(
            `Recorded ${pending.action} reconciled from durable status.`,
          )
        } else
          setMessage(
            "Acknowledgement remains unknown. Refresh status or retry the exact saved operation with the same ID and inputs.",
          )
      } else
        setMessage(
          "Status refreshed. Review the frozen scope and evidence before acting.",
        )
    } catch {
      setMessage(
        "Status is unavailable. Serving state has not been confirmed; refresh when connectivity returns.",
      )
    } finally {
      setBusy(false)
    }
  }

  async function mutate(
    action: string,
    payload: Record<string, unknown>,
    studyId: string,
    operationId?: string,
  ) {
    const id = operationId ?? crypto.randomUUID()
    const pending = { action, id, studyId, protocol: payload.protocol, payload }
    setBusy(true)
    setMessage(`Submitting ${action}…`)
    try {
      const response = await fetch("/api/recommendations/studies", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-forge-csrf": "recommendation-study-v1",
        },
        body: JSON.stringify({
          action,
          ...payload,
          ...(action === "activate" || action === "evaluate"
            ? { operationId: id }
            : action === "evidence"
              ? { evidenceId: id }
              : {}),
        }),
      })
      if ([400, 401, 403, 409].includes(response.status)) {
        const result = await response.json()
        setMessage(
          `Not accepted: ${result.error}. Refresh status before changing the reviewed inputs.`,
        )
        return
      }
      if (!response.ok) throw new Error("acknowledgement unknown")
      setSelected(studyId)
      setUnknown(pending)
      await refresh(pending)
    } catch {
      setUnknown(pending)
      setMessage(
        "Acknowledgement unknown: the server may have recorded this operation. Refresh status before another action.",
      )
    } finally {
      setBusy(false)
    }
  }

  function template(bundle = false) {
    const manifests = status?.manifests ?? []
    setProtocol(
      JSON.stringify(
        {
          version: "profile-study-governance-v1",
          studyId: "",
          mode: bundle ? "efficacy" : "calibration",
          comparison: bundle ? "incumbent-cowatch-mmr" : "incumbent-aa",
          identity: "anonymous-profile-generation-v1",
          surface: "watch-below-player-v1",
          cohort: "human-en-english-durable-v1",
          controlManifestId: "hybrid-profile-viewing-mode-v1",
          challengerManifestId: bundle
            ? "hybrid-profile-viewing-mode-cowatch-mmr-v1"
            : "hybrid-profile-viewing-mode-aa-v1",
          controlManifestDigest: manifests.find(
            (m) => m.id === "hybrid-profile-viewing-mode-v1",
          )?.digest,
          challengerManifestDigest: manifests.find(
            (m) =>
              m.id ===
              (bundle
                ? "hybrid-profile-viewing-mode-cowatch-mmr-v1"
                : "hybrid-profile-viewing-mode-aa-v1"),
          )?.digest,
          incumbentExecution: "hybrid_personalized",
          controlExecution: "profile-viewing-mode-incumbent-v1",
          admissionBps: null,
          challengerProbability: 0.5,
          startsAt: "",
          endsAt: "",
          expiresAt: "",
          stoppingRule: "fixed-enrollment-window-v1",
          plannedAssignmentsPerArm: 200,
          minimumUsefulDelta: null,
          evidenceMaxAgeHours: 24,
          calibrationEvaluationId: null,
          cowatch: bundle
            ? {
                mode: "frozen-source-controlled-trial-v1",
                graphGenerationId: "",
                sourceWindow: {
                  version: "episode-event-window-v1",
                  windowStart: "",
                  windowEnd: "",
                  evaluationAsOf: "",
                },
                calibrationCompletedAt: "",
                trialValidUntil: "",
                earliestDependencyExpiresAt: "",
                shadowEvaluationId: "",
                shadowDecisionId: "",
              }
            : null,
          composition: bundle
            ? {
                protocolId: "",
                manifestId: "hybrid-profile-viewing-mode-cowatch-mmr-v1",
                composerVersion: "source-interest-theme-mmr-v1",
                configDigest: "",
                evidenceDigest: "",
                reviewDigest: "",
                authorityRevision: null,
                cowatchGenerationId: "",
              }
            : null,
        },
        null,
        2,
      ),
    )
  }

  function evidenceTemplate(kind: "readiness" | "outcomes") {
    const receipt = { source: "reviewed-artifact", reference: "", sha256: "" }
    const base = {
      kind,
      capturedAt: new Date().toISOString(),
      validUntil: new Date(Date.now() + 6 * 3_600_000).toISOString(),
      collection: receipt,
      retention: receipt,
    }
    const arm = {
      requests: null,
      timeoutsOrErrors: null,
      requestsWithCards: null,
      p95LatencyMs: null,
      claimedEpisodes: null,
      missingActiveEpisodes: null,
      attributionFailures: null,
      fatalPlaybackErrors: null,
    }
    setEvidence(
      JSON.stringify(
        kind === "readiness"
          ? { ...base, storage: receipt, rollback: receipt }
          : {
              ...base,
              windowStart: study?.protocol.startsAt,
              windowEnd: study
                ? new Date(
                    Date.parse(String(study.protocol.endsAt)) + 30 * 3_600_000,
                  ).toISOString()
                : "",
              delivery: receipt,
              playback: receipt,
              browserJourney: receipt,
              control: arm,
              challenger: arm,
            },
        null,
        2,
      ),
    )
  }

  function parse(text: string) {
    try {
      return JSON.parse(text) as Record<string, unknown>
    } catch {
      setMessage("Enter valid JSON before review.")
      return null
    }
  }
  const maturity = study
    ? new Date(Date.parse(String(study.protocol.endsAt)) + 30 * 3_600_000)
    : null
  const readiness = study?.evidence.find(
    (e) =>
      e.kind === "readiness" && Date.parse(e.payload.validUntil) > Date.now(),
  )
  const outcomes = study?.evidence.find(
    (e) =>
      e.kind === "outcomes" && Date.parse(e.payload.validUntil) > Date.now(),
  )

  return (
    <div className="mt-5 border-t border-[var(--color-hairline)] pt-4">
      <button
        className={button}
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
          if (!open && !status) void refresh()
        }}
      >
        Governed profile studies
      </button>
      {open ? (
        <div className="mt-4 space-y-4">
          <p className="text-[12px]">
            A/A checks routing and collection; A/B evaluates the frozen
            comparator. Semantic control differs from the live hybrid incumbent
            and cannot authorize an incremental co-watch or MMR default.
            Enrollment admission is separate from the 50/50 split among admitted
            profiles.
          </p>
          <button
            className={button}
            disabled={busy}
            type="button"
            onClick={() => void refresh()}
          >
            Refresh study status
          </button>
          {unknown ? (
            <button
              className={button}
              disabled={busy}
              type="button"
              onClick={() =>
                void mutate(
                  unknown.action,
                  unknown.payload,
                  unknown.studyId,
                  unknown.id,
                )
              }
            >
              Retry exact saved operation
            </button>
          ) : null}
          <label className="block text-[12px]">
            Study
            <select
              className={inputClass}
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Select a prepared study</option>
              {status?.studies.map((s) => (
                <option key={s.experimentId}>{s.experimentId}</option>
              ))}
            </select>
          </label>
          {study ? (
            <div className="space-y-2 text-[12px]">
              <p>
                <strong>
                  {study.activatedAt
                    ? "Activated"
                    : "Prepared; enrollment disabled"}
                </strong>{" "}
                · {String(study.protocol.mode)} ·{" "}
                {String(study.protocol.comparison)}
              </p>
              <p>
                Admission: {Number(study.protocol.admissionBps) / 100}% of
                eligible profiles. Among admitted: 50% control, 50% challenger.
              </p>
              <p>
                Enrollment: {String(study.protocol.startsAt)} →{" "}
                {String(study.protocol.endsAt)}. Earliest evaluation:{" "}
                {maturity?.toISOString()}.
              </p>
              <p>
                Fixed time window; minimum{" "}
                {String(study.protocol.plannedAssignmentsPerArm)} assignments
                per arm. Recorded assignments: {study.enrolledCount}. Input
                authority revision: {study.privacyRevision}.
              </p>
              <p className="break-all">
                Protocol digest: {study.protocolDigest}
              </p>
              <p>
                Latest result:{" "}
                {study.evaluations[0]?.result.decision ?? "No evaluation"}.{" "}
                {study.protocol.mode === "calibration"
                  ? "Calibration has no efficacy authority."
                  : "This bounded combined trial cannot authorize permanent graph refresh."}
              </p>
              {study.evaluations[0] ? (
                <p>
                  Recorded input epoch:{" "}
                  {study.evaluations[0].privacyRevision ===
                  study.privacyRevision
                    ? "unchanged"
                    : "invalidated; republish after reconciliation"}
                  . Publication validity ends {study.evaluations[0].expiresAt}.
                  Reasons:{" "}
                  {study.evaluations[0].result.reasonCodes?.join(", ") ??
                    "none recorded"}
                  . Serving dependencies are rechecked for each request.
                </p>
              ) : null}
              <details>
                <summary>Review frozen protocol</summary>
                <pre className="overflow-auto">
                  {JSON.stringify(study.protocol, null, 2)}
                </pre>
              </details>
              <div className="flex gap-2">
                <button
                  className={button}
                  disabled={disabled}
                  type="button"
                  onClick={() => evidenceTemplate("readiness")}
                >
                  Start readiness evidence
                </button>
                <button
                  className={button}
                  disabled={disabled}
                  type="button"
                  onClick={() => evidenceTemplate("outcomes")}
                >
                  Start outcome evidence
                </button>
              </div>
              <label className="block">
                Reviewed evidence JSON
                <textarea
                  aria-label="Reviewed study evidence"
                  rows={8}
                  className={inputClass}
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                />
              </label>
              <p>
                Record minimized receipt references and SHA-256 hashes from
                collection, retention, storage and rollback checks for
                readiness. Outcome evidence also needs the complete follow-up
                window, delivery/playback/browser receipts and numerical arm
                counts. The server computes guardrails; uploaded PASS flags are
                rejected.
              </p>
              <button
                className={button}
                disabled={disabled || !evidence}
                type="button"
                onClick={() => {
                  const parsed = parse(evidence)
                  if (parsed)
                    void mutate(
                      "evidence",
                      {
                        studyId: study.experimentId,
                        protocolDigest: study.protocolDigest,
                        evidence: parsed,
                      },
                      study.experimentId,
                    )
                }}
              >
                Record reviewed evidence
              </button>
              <p>
                Readiness:{" "}
                {readiness ? "fresh reviewed receipt" : "missing or stale"}.
                Outcome evidence:{" "}
                {outcomes ? "fresh reviewed receipt" : "missing or stale"}.{" "}
                {status?.pointer?.killSwitchEnabled
                  ? "Emergency hold is active."
                  : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  className={button}
                  disabled={
                    disabled ||
                    !!study.activatedAt ||
                    !readiness ||
                    !status?.pointer ||
                    status.pointer.killSwitchEnabled
                  }
                  type="button"
                  onClick={() => {
                    if (
                      readiness &&
                      window.confirm(
                        `Activate ${study.experimentId} with ${Number(study.protocol.admissionBps) / 100}% admission and frozen 50/50 arms?`,
                      )
                    )
                      void mutate(
                        "activate",
                        {
                          studyId: study.experimentId,
                          protocolDigest: study.protocolDigest,
                          evidenceId: readiness.id,
                          expectedPointerGeneration:
                            status?.pointer?.generation,
                        },
                        study.experimentId,
                      )
                  }}
                >
                  Activate reviewed study
                </button>
                <button
                  className={button}
                  disabled={
                    disabled ||
                    !study.activatedAt ||
                    !outcomes ||
                    !maturity ||
                    Date.now() < maturity.getTime()
                  }
                  type="button"
                  onClick={() => {
                    if (outcomes)
                      void mutate(
                        "evaluate",
                        {
                          studyId: study.experimentId,
                          protocolDigest: study.protocolDigest,
                          evidenceId: outcomes.id,
                        },
                        study.experimentId,
                      )
                  }}
                >
                  Evaluate mature cohort
                </button>
              </div>
            </div>
          ) : null}
          <details>
            <summary className="text-[12px]">
              Prepare a new immutable protocol
            </summary>
            <p className="my-2 text-[12px]">
              Choose an unused study ID, owner-approved admission, and UTC
              dates. A/A needs at least two full UTC days; expiry must exceed
              follow-up and stay within 29 days. Efficacy requires a valid
              calibration evaluation, a calibrated sample target and a positive
              prespecified effect margin. Preparing does not activate serving.
            </p>
            <button
              className={button}
              type="button"
              disabled={disabled || !status}
              onClick={() => template(false)}
            >
              Start incumbent A/A protocol
            </button>
            <button
              className={button}
              disabled={disabled}
              type="button"
              onClick={() => template(true)}
            >
              Start combined co-watch/MMR protocol
            </button>
            <p>
              Complete incumbent A/A first. Combined efficacy requires its exact
              calibration result, a freshly qualified graph and a separately
              reviewed composition binding. It measures their combined effect;
              permanent default needs a separately reviewed graph refresh
              policy.
            </p>
            <label className="block text-[12px]">
              Protocol JSON
              <textarea
                aria-label="Study protocol"
                rows={12}
                className={inputClass}
                value={protocol}
                onChange={(e) => setProtocol(e.target.value)}
              />
            </label>
            <button
              className={button}
              type="button"
              disabled={disabled || !protocol}
              onClick={() => {
                const parsed = parse(protocol)
                if (
                  parsed &&
                  typeof parsed.studyId === "string" &&
                  window.confirm(
                    "Freeze this exact protocol for review? Later changes require a new study ID.",
                  )
                )
                  void mutate("prepare", { protocol: parsed }, parsed.studyId)
              }}
            >
              Prepare protocol for review
            </button>
          </details>
          {unknown ? (
            <p className="break-all text-[12px]">
              Unconfirmed {unknown.action} operation: {unknown.id}. Study:{" "}
              {unknown.studyId}.
            </p>
          ) : null}
          <p role="status" aria-live="polite" className="text-[12px]">
            {message}
          </p>
        </div>
      ) : null}
    </div>
  )
}

function canonical(value: unknown): string {
  return JSON.stringify(
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        )
      : value,
  )
}
