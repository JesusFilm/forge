"use client"

import { useRef, useState } from "react"

type RefreshStatus = {
  status: string
  grant: { id: string; expiresAt: string; revokedAt: string | null } | null
  currentRelease: {
    id: string
    validUntil: string
    revokedAt: string | null
  } | null
  latestAttempt: {
    id: string
    status: string
    reasonCode: string | null
  } | null
  lastSuccess: { completedAt: string | null } | null
  nextAttemptAt: string | null
}
type RefreshMutation =
  | {
      action: "authorize"
      operationId: string
      expectedPointerGeneration: number
      budget: Record<string, unknown>
    }
  | { action: "disable"; grantId: string }
const mutationConfirmed = (next: RefreshStatus, request: RefreshMutation) =>
  request.action === "authorize"
    ? next.grant?.id === request.operationId
    : next.grant?.id === request.grantId && next.grant.revokedAt !== null
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
function parseStatus(value: unknown): RefreshStatus | null {
  if (!record(value) || typeof value.status !== "string") return null
  for (const key of ["grant", "currentRelease", "latestAttempt", "lastSuccess"])
    if (value[key] !== null && !record(value[key])) return null
  if (value.nextAttemptAt !== null && typeof value.nextAttemptAt !== "string")
    return null
  const { grant, currentRelease, latestAttempt, lastSuccess } = value
  if (
    record(grant) &&
    (typeof grant.id !== "string" ||
      typeof grant.expiresAt !== "string" ||
      (grant.revokedAt !== null && typeof grant.revokedAt !== "string"))
  )
    return null
  if (
    record(currentRelease) &&
    (typeof currentRelease.id !== "string" ||
      typeof currentRelease.validUntil !== "string" ||
      (currentRelease.revokedAt !== null &&
        typeof currentRelease.revokedAt !== "string"))
  )
    return null
  if (
    record(latestAttempt) &&
    (typeof latestAttempt.id !== "string" ||
      typeof latestAttempt.status !== "string" ||
      (latestAttempt.reasonCode !== null &&
        typeof latestAttempt.reasonCode !== "string"))
  )
    return null
  if (
    record(lastSuccess) &&
    lastSuccess.completedAt !== null &&
    typeof lastSuccess.completedAt !== "string"
  )
    return null
  return value as RefreshStatus // Every rendered field is validated above.
}

const endpoint = "/api/recommendations/cowatch-refresh"
const buttonClass =
  "rounded-sm border border-[var(--color-hairline)] px-3 py-2 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-50"

export function CowatchRefreshControls(props: {
  generation: number
  killSwitchEnabled: boolean
}) {
  const [status, setStatus] = useState<RefreshStatus | null>(null)
  const [budgetText, setBudgetText] = useState("")
  const [reviewedBudget, setReviewedBudget] = useState<Record<
    string,
    unknown
  > | null>(null)
  const [operationId, setOperationId] = useState<string | null>(null)
  const [reviewedGeneration, setReviewedGeneration] = useState(props.generation)
  const [unresolvedRequest, setUnresolvedRequest] =
    useState<RefreshMutation | null>(null)
  const [busy, setBusy] = useState(false)
  const [unknown, setUnknown] = useState(false)
  const [message, setMessage] = useState("")
  const pending = useRef(false)

  async function loadStatus() {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    try {
      const response = await fetch(
        `${endpoint}${operationId ? `?operationId=${operationId}` : ""}`,
        { credentials: "same-origin", cache: "no-store" },
      )
      const body: unknown = await response.json()
      const next =
        response.ok && record(body) ? parseStatus(body.refresh) : null
      if (!next) {
        setMessage(
          "Refresh status is unavailable. Keep the original operation ID and try inspection again.",
        )
        return
      }
      setStatus(next)
      if (
        unknown &&
        unresolvedRequest &&
        !mutationConfirmed(next, unresolvedRequest)
      ) {
        setMessage(
          "The original operation is not confirmed yet. Inspect again or retry the same operation; its identity and reviewed inputs are preserved.",
        )
        return
      }
      setUnknown(false)
      setUnresolvedRequest(null)
      setReviewedBudget(null)
      setMessage(
        "Current refresh state loaded. Serving still depends on a valid release and graph.",
      )
    } catch {
      setMessage(
        "Refresh status is unavailable. Keep the original operation ID and try inspection again.",
      )
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  function reviewBudget() {
    try {
      const value: unknown = JSON.parse(budgetText)
      if (!record(value)) throw new TypeError("Expected capacity object")
      setOperationId(crypto.randomUUID())
      setReviewedGeneration(props.generation)
      setReviewedBudget(value)
      setMessage(
        "Review the exact capacity ceilings below. Confirm authorizes this policy for up to 29 days.",
      )
    } catch {
      setMessage("Paste a valid reviewed capacity budget as a JSON object.")
    }
  }

  async function mutate(disable: boolean) {
    if (
      pending.current ||
      unknown ||
      (!disable && (!reviewedBudget || props.killSwitchEnabled)) ||
      (disable && !status?.grant)
    )
      return
    const id = disable
      ? status!.grant!.id
      : (operationId ?? crypto.randomUUID())
    setOperationId(id)
    await sendMutation(
      disable
        ? { action: "disable", grantId: id }
        : {
            action: "authorize",
            operationId: id,
            expectedPointerGeneration: reviewedGeneration,
            budget: reviewedBudget!,
          },
    )
  }

  async function sendMutation(request: RefreshMutation) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setUnresolvedRequest(request)
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-forge-csrf": "recommendation-cowatch-refresh-v1",
        },
        body: JSON.stringify(request),
      })
      if ([400, 401, 403, 409].includes(response.status)) {
        if (!unknown) {
          setReviewedBudget(null)
          setUnresolvedRequest(null)
        }
        setMessage(
          response.status === 401
            ? "Sign in again before authorizing refresh."
            : "Refresh was refused. Inspect current state and review capacity and permissions before trying again.",
        )
        return
      }
      const body: unknown = await response.json()
      const next =
        response.ok && record(body) ? parseStatus(body.refresh) : null
      if (!next || !mutationConfirmed(next, request)) {
        setUnknown(true)
        setMessage(
          "Acknowledgement unknown. Reconcile the original operation before another change.",
        )
        return
      }
      setStatus(next)
      setUnknown(false)
      setUnresolvedRequest(null)
      setReviewedBudget(null)
      setMessage(
        request.action === "disable"
          ? "Refresh stopped. The current release keeps its existing deadline; emergency stop remains available separately."
          : "Refresh authorization recorded. Inspect attempts and serving provenance to confirm execution.",
      )
    } catch {
      setUnknown(true)
      setMessage(
        "Acknowledgement unknown. Reconcile the original operation before another change.",
      )
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return (
    <section
      aria-label="Bounded co-watch refresh"
      className="mt-5 border-t border-[var(--color-hairline)] pt-4"
    >
      <h4 className="font-medium">Bounded co-watch refresh</h4>
      <p className="mt-2">
        Refresh uses the approved policy and a complete seven-day window ending
        at least seven hours ago. At most one new publication every 12 hours;
        refusal or revocation serves the incumbent fallback.
      </p>
      <button
        type="button"
        className={`${buttonClass} mt-3`}
        disabled={busy}
        onClick={() => void loadStatus()}
      >
        {unknown ? "Reconcile refresh operation" : "Inspect refresh status"}
      </button>
      {unknown && unresolvedRequest ? (
        <button
          type="button"
          className={`${buttonClass} ml-2 mt-3`}
          disabled={
            busy ||
            (unresolvedRequest.action === "authorize" &&
              props.killSwitchEnabled)
          }
          onClick={() => void sendMutation(unresolvedRequest)}
        >
          Retry original refresh operation
        </button>
      ) : null}
      {status ? (
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          <div>
            <dt>Refresh state</dt>
            <dd>{status.status.replaceAll("_", " ")}</dd>
          </div>
          <div>
            <dt>Authorization expires</dt>
            <dd>
              {status.grant?.expiresAt ?? "Not authorized"}
              {status.grant?.revokedAt ? " · stopped" : ""}
            </dd>
          </div>
          <div>
            <dt>Current graph deadline</dt>
            <dd>
              {status.currentRelease?.validUntil ?? "No release"}
              {status.currentRelease?.revokedAt ? " · revoked" : ""}
            </dd>
          </div>
          <div>
            <dt>Last successful refresh</dt>
            <dd>{status.lastSuccess?.completedAt ?? "None recorded"}</dd>
          </div>
          <div>
            <dt>Latest attempt</dt>
            <dd>
              {status.latestAttempt?.status ?? "None"}
              {status.latestAttempt?.reasonCode
                ? ` · ${status.latestAttempt.reasonCode}`
                : ""}
            </dd>
          </div>
          <div>
            <dt>Next eligible attempt</dt>
            <dd>{status.nextAttemptAt ?? "Not scheduled"}</dd>
          </div>
        </dl>
      ) : null}
      {status?.grant && !status.grant.revokedAt ? (
        <button
          type="button"
          className={`${buttonClass} mt-3`}
          disabled={busy || unknown}
          onClick={() => void mutate(true)}
        >
          Stop automatic refresh
        </button>
      ) : null}
      <details className="mt-3">
        <summary className="cursor-pointer font-medium">
          Authorize with reviewed capacity
        </summary>
        <p className="mt-2">
          Requires a valid active direct release, recent owner authentication
          and fresh storage admission. Emergency stop cancels this authorization
          permanently.
        </p>
        <label className="mt-3 block">
          Reviewed capacity budget
          <textarea
            rows={6}
            maxLength={12000}
            className="mt-1 w-full rounded-sm border border-[var(--color-hairline)] p-2 font-mono"
            value={budgetText}
            disabled={busy || unknown || props.killSwitchEnabled}
            onChange={(event) => {
              setBudgetText(event.target.value)
              setReviewedBudget(null)
            }}
          />
        </label>
        <button
          type="button"
          className={`${buttonClass} mt-2`}
          disabled={busy || unknown || !budgetText || props.killSwitchEnabled}
          onClick={reviewBudget}
        >
          Review refresh authorization
        </button>
        {reviewedBudget ? (
          <div className="mt-3">
            <pre className="overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(reviewedBudget, null, 2)}
            </pre>
            <button
              type="button"
              className={`${buttonClass} mt-2`}
              disabled={busy || unknown || props.killSwitchEnabled}
              onClick={() => void mutate(false)}
            >
              Confirm bounded refresh
            </button>
            <button
              type="button"
              className={`${buttonClass} ml-2`}
              disabled={busy || unknown}
              onClick={() => setReviewedBudget(null)}
            >
              Cancel
            </button>
          </div>
        ) : null}
      </details>
      {operationId ? (
        <p className="mt-2 break-all">Refresh operation ID: {operationId}</p>
      ) : null}
      <p role="status" aria-live="polite" className="mt-2 min-h-5">
        {message}
      </p>
    </section>
  )
}
