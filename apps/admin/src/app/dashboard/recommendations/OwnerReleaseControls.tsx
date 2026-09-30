"use client"

import { useRef, useState } from "react"
import { readPromotionForbiddenReason } from "./promotion-response"
type PreparedRelease = {
  operationId: string
  expectedPointerGeneration: number
  bindingDigest: string
  manifestId: string
  graphGenerationId: string
  validUntil: string
  dependencyExpiresAt: string
  binding: {
    sourceWindow: {
      windowStart: string
      windowEnd: string
      evaluationAsOf: string
    }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

function isPreparedRelease(value: unknown): value is PreparedRelease {
  if (
    !isRecord(value) ||
    !isRecord(value.binding) ||
    !isRecord(value.binding.sourceWindow)
  )
    return false
  const sourceWindow = value.binding.sourceWindow
  return (
    typeof value.operationId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value.operationId,
    ) &&
    typeof value.expectedPointerGeneration === "number" &&
    Number.isInteger(value.expectedPointerGeneration) &&
    [
      "bindingDigest",
      "manifestId",
      "graphGenerationId",
      "validUntil",
      "dependencyExpiresAt",
    ].every((key) => typeof value[key] === "string") &&
    ["windowStart", "windowEnd", "evaluationAsOf"].every(
      (key) => typeof sourceWindow[key] === "string",
    )
  )
}

export function OwnerReleaseControls(props: {
  generation: number
  killSwitchEnabled: boolean
  ownerRelease?: {
    id: string
    validUntil: string
    revoked: boolean
    graphGenerationId: string
  } | null
}) {
  const [graph, setGraph] = useState("")
  const [operationId, setOperationId] = useState<string | null>(null)
  const [review, setReview] = useState<PreparedRelease | null>(null)
  const [state, setState] = useState<
    "idle" | "pending" | "prepared" | "unknown" | "recorded"
  >("idle")
  const [message, setMessage] = useState("")
  const pending = useRef(false)
  const buttonClass =
    "rounded-sm border border-[var(--color-hairline)] px-3 py-2 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-50"

  async function submit(activate: boolean) {
    if (pending.current) return
    pending.current = true
    const id = operationId ?? crypto.randomUUID()
    setOperationId(id)
    setState("pending")
    setMessage(
      activate
        ? "Activating the exact reviewed release…"
        : "Validating this graph and its current source dependencies…",
    )
    try {
      const response = await fetch("/api/recommendations/promotion", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-forge-csrf": "recommendation-promotion-v1",
        },
        body: JSON.stringify({
          action: activate ? "activate_owner_release" : "prepare_owner_release",
          operationId: id,
          expectedPointerGeneration:
            review?.expectedPointerGeneration ?? props.generation,
          graphGenerationId: review?.graphGenerationId ?? graph,
          ...(activate && review
            ? { bindingDigest: review.bindingDigest }
            : {}),
        }),
      })
      if ([400, 401, 403, 409].includes(response.status)) {
        const forbiddenReason =
          response.status === 403
            ? await readPromotionForbiddenReason(response)
            : null
        setState("idle")
        setReview(null)
        setMessage(
          response.status === 401
            ? "Sign in again to use direct activation."
            : forbiddenReason === "csrf_failed"
              ? "Request security validation failed. Reload the canonical Admin page before trying again."
              : forbiddenReason === "permission_denied"
                ? "Direct activation requires operator and permanent-approval permissions."
                : "The release was refused. Reload current state and review graph availability before another operation.",
        )
        return
      }
      if (!response.ok) {
        setState("unknown")
        setMessage(
          "Acknowledgement unknown. Reconcile this exact operation before any retry.",
        )
        return
      }
      const result = await response.json()
      if (result.ownerRelease?.status === "prepared") {
        const prepared = result.ownerRelease
        if (!isPreparedRelease(prepared)) {
          setState("unknown")
          setMessage(
            "The review receipt could not be read. Reconcile the operation before continuing.",
          )
          return
        }
        setReview(prepared)
        setState("prepared")
        setMessage(
          "Graph validation completed. Review the exact expiry and activate below.",
        )
      } else {
        setState("recorded")
        setMessage(
          `Recorded release: ${String(result.ownerRelease?.status ?? "unknown")}. Reload to inspect the current serving state.`,
        )
      }
    } catch {
      setState("unknown")
      setMessage(
        "Acknowledgement unknown. Reconcile this exact operation before any retry.",
      )
    } finally {
      pending.current = false
    }
  }

  async function reconcile() {
    if (!operationId || pending.current) return
    pending.current = true
    try {
      const response = await fetch(
        `/api/recommendations/promotion?ownerOperationId=${operationId}`,
        { credentials: "same-origin", cache: "no-store" },
      )
      if (!response.ok) {
        setMessage(
          "Status is unavailable. Keep this operation ID; sign in again if authentication expired.",
        )
        return
      }
      const result = await response.json()
      if (result.ownerRelease?.status === "not_recorded") {
        setState(review ? "prepared" : "idle")
        setMessage(
          "No committed release for this operation. You may retry the same exact operation; activation revalidates all dependencies.",
        )
      } else {
        setState("recorded")
        setMessage(
          `Recorded release: ${String(result.ownerRelease?.status ?? "unknown")}. No activation retry is needed. Reload to inspect current serving state.`,
        )
      }
    } catch {
      setMessage(
        "Status is unavailable. Keep this operation ID and reconcile when connectivity returns.",
      )
    } finally {
      pending.current = false
    }
  }

  return (
    <section
      aria-label="Owner-approved co-watch and MMR"
      className="mb-5 border-b border-[var(--color-hairline)] pb-5 text-[12px]"
    >
      <h3 className="font-medium">Owner-approved co-watch and MMR</h3>
      <p className="mt-2 text-[var(--color-text-muted)]">
        Direct activation uses the reviewed policy. Causal usefulness remains
        unmeasured. Graph refresh is manual; expiry serves the incumbent
        fallback.
      </p>
      {props.ownerRelease ? (
        <p className="mt-2">
          Current release {props.ownerRelease.id} · graph{" "}
          {props.ownerRelease.graphGenerationId} · expires{" "}
          {props.ownerRelease.validUntil}
          {props.ownerRelease.revoked ? " · revoked" : ""}
        </p>
      ) : null}
      <label className="mt-3 block">
        Published graph generation
        <input
          value={graph}
          onChange={(event) => {
            setGraph(event.target.value)
            setOperationId(null)
          }}
          disabled={state !== "idle" || props.killSwitchEnabled}
          maxLength={64}
          className="mt-1 block w-full rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2 font-mono"
        />
      </label>
      {state === "idle" ? (
        <button
          type="button"
          className={`${buttonClass} mt-3`}
          disabled={!/^[a-f0-9]{64}$/.test(graph) || props.killSwitchEnabled}
          onClick={() => void submit(false)}
        >
          Prepare direct release
        </button>
      ) : null}
      {review ? (
        <div className="mt-3 break-words">
          <p>Policy: {review.manifestId}</p>
          <p>
            Source window: {review.binding.sourceWindow.windowStart} →{" "}
            {review.binding.sourceWindow.windowEnd}; cutoff{" "}
            {review.binding.sourceWindow.evaluationAsOf}
          </p>
          <p>
            Release expiry: {review.validUntil}; earliest dependency expiry:{" "}
            {review.dependencyExpiresAt}
          </p>
          <p>
            Binding: {review.bindingDigest}; expected pointer generation:{" "}
            {review.expectedPointerGeneration}
          </p>
          {state === "prepared" ? (
            <button
              type="button"
              className={`${buttonClass} mt-3`}
              disabled={props.killSwitchEnabled}
              onClick={() => void submit(true)}
            >
              Activate reviewed direct release
            </button>
          ) : null}
        </div>
      ) : null}
      {operationId ? (
        <p className="mt-2 break-all">Operation ID: {operationId}</p>
      ) : null}
      {state === "unknown" ? (
        <button
          type="button"
          className={`${buttonClass} mt-3`}
          onClick={() => void reconcile()}
        >
          Reconcile direct release
        </button>
      ) : null}
      {state === "recorded" ? (
        <button
          type="button"
          className={`${buttonClass} mt-3`}
          onClick={() => window.location.reload()}
        >
          Reload serving state
        </button>
      ) : null}
      <p role="status" aria-live="polite" className="mt-2 min-h-5">
        {message}
      </p>
    </section>
  )
}
