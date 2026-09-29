"use client"

import { useState } from "react"

type Props = Readonly<{
  generation: number
  stage: "control" | "bounded" | "permanent"
  targetManifestId: string | null
  lastKnownGoodManifestId: string
  approvalId: string | null
  evaluationId: string | null
  exposureCeilingBps: number
  proposedExposureCeilingBps: number
  killSwitchEnabled: boolean
  ready: boolean
}>

type MutationState =
  | "idle"
  | "pending"
  | "complete"
  | "failed"
  | "queued"
  | "acknowledgement-unknown"
  | "stale-page"
  | "authorization-failure"

export function PromotionControls(props: Props) {
  const [state, setState] = useState<MutationState>("idle")
  const [message, setMessage] = useState<string | null>(null)
  const [operationId, setOperationId] = useState<string | null>(null)
  const disabled = [
    "pending",
    "queued",
    "acknowledgement-unknown",
    "stale-page",
  ].includes(state)

  async function mutate(body: Record<string, unknown>, confirmation?: string) {
    if (confirmation && !window.confirm(confirmation)) return
    const transition = [
      "activate_bounded",
      "confirm_permanent",
      "manual_rollback",
    ].includes(String(body.action))
    const id = transition ? crypto.randomUUID() : null
    if (id) setOperationId(id)
    setState("pending")
    setMessage("Submitting the governed transition…")
    try {
      const response = await fetch("/api/recommendations/promotion", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-forge-csrf": "recommendation-promotion-v1",
        },
        body: JSON.stringify({ ...body, ...(id ? { operationId: id } : {}) }),
      })
      if (response.status === 409) {
        setState("stale-page")
        setMessage("This page is stale. Reload before making another decision.")
        return
      }
      if (response.status === 401 || response.status === 403) {
        setState("authorization-failure")
        setMessage(
          response.status === 401
            ? "Sign in again before confirming this decision."
            : "Your role is not authorized for this decision.",
        )
        return
      }
      if (response.status === 400) {
        setState("failed")
        setMessage(
          "The reviewed transition was rejected. Refresh the evidence before trying again.",
        )
        return
      }
      if (!response.ok) throw new Error("acknowledgement unknown")
      if (transition) {
        setState("queued")
        setMessage(
          "Request recorded. Queued execution has not yet been confirmed; refresh transition status.",
        )
        return
      }
      setState("complete")
      setMessage("Decision recorded. Reloading the immutable audit…")
      window.location.reload()
    } catch {
      setState("acknowledgement-unknown")
      setMessage(
        "Acknowledgement unknown. The transition may have been recorded. Refresh status before any retry.",
      )
    }
  }

  async function reconcile() {
    try {
      const response = await fetch(
        `/api/recommendations/promotion${operationId ? `?operationId=${operationId}` : ""}`,
        { cache: "no-store", credentials: "same-origin" },
      )
      if (!response.ok) throw new Error("status unavailable")
      const result = await response.json()
      if (result.run?.state === "COMPLETED") {
        setState("complete")
        setMessage("Execution confirmed. Reloading current serving state…")
        window.location.reload()
        return
      }
      if (["FAILED", "FENCED"].includes(result.run?.state)) {
        setState("stale-page")
        setMessage(
          `Operation ${result.run.state.toLowerCase()}. Reload and review current state before another decision.`,
        )
        return
      }
      setMessage(
        result.run
          ? `Operation is ${result.run.state.toLowerCase()}; execution is not confirmed. Refresh status again.`
          : `No exact operation is confirmed. Current pointer generation: ${result.pointer?.generation ?? "unavailable"}. Review the immutable audit before another decision.`,
      )
    } catch {
      setMessage(
        "Status is unavailable. Keep the operation ID and refresh when connectivity returns.",
      )
    }
  }

  const buttonClass =
    "rounded-sm border border-[var(--color-hairline)] px-3 py-2 text-[12px] font-medium transition-colors hover:bg-[var(--color-surface-raised)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {!props.approvalId && props.targetManifestId ? (
          <button
            type="button"
            className={buttonClass}
            disabled={disabled || props.proposedExposureCeilingBps <= 0}
            onClick={() =>
              mutate({
                action: "approve_bounded",
                manifestId: props.targetManifestId,
                maxExposureBps: props.proposedExposureCeilingBps,
              })
            }
          >
            Approve exact manifest
          </button>
        ) : null}
        {props.stage === "control" && props.approvalId ? (
          <button
            type="button"
            className={buttonClass}
            disabled={disabled || !props.ready || props.killSwitchEnabled}
            onClick={() =>
              mutate({
                action: "activate_bounded",
                expectedPointerGeneration: props.generation,
                targetManifestId: props.targetManifestId,
                approvalId: props.approvalId,
                evaluationId: props.evaluationId,
                exposureCeilingBps: props.proposedExposureCeilingBps,
              })
            }
          >
            Activate bounded stage
          </button>
        ) : null}
        {props.stage === "bounded" &&
        props.approvalId &&
        props.evaluationId &&
        props.proposedExposureCeilingBps > props.exposureCeilingBps ? (
          <button
            type="button"
            className={buttonClass}
            disabled={disabled || !props.ready || props.killSwitchEnabled}
            onClick={() =>
              mutate({
                action: "activate_bounded",
                expectedPointerGeneration: props.generation,
                targetManifestId: props.targetManifestId,
                approvalId: props.approvalId,
                evaluationId: props.evaluationId,
                exposureCeilingBps: props.proposedExposureCeilingBps,
              })
            }
          >
            Increase bounded stage
          </button>
        ) : null}
        {props.stage === "bounded" && props.approvalId && props.evaluationId ? (
          <button
            type="button"
            className={buttonClass}
            disabled={disabled || !props.ready || props.killSwitchEnabled}
            onClick={() =>
              mutate(
                {
                  action: "confirm_permanent",
                  expectedPointerGeneration: props.generation,
                  targetManifestId: props.targetManifestId,
                  approvalId: props.approvalId,
                  evaluationId: props.evaluationId,
                  exposureCeilingBps: 10_000,
                },
                "Make this strategy the permanent default? This requires recent authentication and remains fully audited.",
              )
            }
          >
            Confirm permanent default
          </button>
        ) : null}
        {props.stage !== "control" ? (
          <button
            type="button"
            className={buttonClass}
            disabled={disabled}
            onClick={() =>
              mutate(
                {
                  action: "manual_rollback",
                  expectedPointerGeneration: props.generation,
                  targetManifestId: props.lastKnownGoodManifestId,
                  evaluationId: props.evaluationId,
                  exposureCeilingBps: 0,
                },
                `Restore ${props.lastKnownGoodManifestId} and fence all outstanding influence?`,
              )
            }
          >
            Restore last-known-good
          </button>
        ) : null}
        <button
          type="button"
          className={buttonClass}
          disabled={state === "pending"}
          onClick={() =>
            mutate(
              {
                action: "set_kill_switch",
                expectedPointerGeneration: props.generation,
                enabled: !props.killSwitchEnabled,
                reason: props.killSwitchEnabled
                  ? "incident_resolved"
                  : "manual_emergency_stop",
              },
              props.killSwitchEnabled
                ? "Clear the emergency hold and resume the audited stage?"
                : "Stop challenger influence and fence cached and persisted influence now?",
            )
          }
        >
          {props.killSwitchEnabled ? "Clear emergency hold" : "Emergency stop"}
        </button>
      </div>
      {["queued", "acknowledgement-unknown", "stale-page"].includes(state) ? (
        <div className="mt-3 text-[12px]">
          <button
            type="button"
            className={buttonClass}
            onClick={() => void reconcile()}
          >
            Refresh transition status
          </button>
          {operationId ? (
            <p className="mt-2 break-all">Operation ID: {operationId}</p>
          ) : null}
        </div>
      ) : null}
      <p
        className="mt-3 min-h-5 text-[12px] text-[var(--color-text-muted)]"
        role="status"
        aria-live="polite"
        data-mutation-state={state}
      >
        {message ??
          "Every action is generation-fenced and writes immutable audit evidence."}
      </p>
    </div>
  )
}
