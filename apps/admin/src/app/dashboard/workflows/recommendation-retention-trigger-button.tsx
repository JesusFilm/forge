"use client"

import { useRef, useState } from "react"
import { RefreshCcw } from "lucide-react"

export function RecommendationRetentionTriggerButton() {
  const [pending, setPending] = useState(false)
  const [queued, setQueued] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const operationId = useRef<string | null>(null)

  async function trigger() {
    setPending(true)
    setMessage(null)
    operationId.current ??= window.crypto.randomUUID()
    try {
      const response = await fetch("/api/recommendations/retention/manual", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forge-csrf": "recommendation-retention-manual-v1",
        },
        body: JSON.stringify({ operationId: operationId.current }),
      })
      const body = (await response.json().catch(() => null)) as {
        ok?: boolean
        error?: string
        dispatch?: {
          ledgerRunId?: string
          state?: "queued" | "existing" | "uncertain"
        }
      } | null
      // A rejected dispatch response can be uncertain after runtime commit.
      // Require ledger reconciliation before any new operator request.
      setQueued(true)
      setMessage(
        response.ok
          ? body?.dispatch?.state === "existing"
            ? `Existing request (${body.dispatch.ledgerRunId ?? "receipt pending"}). Check the ledgers; no new pass was started.`
            : `Queued one bounded pass (${body?.dispatch?.ledgerRunId ?? "receipt pending"}). Check retention ledgers for the result.`
          : response.status === 409
            ? `Dispatch outcome uncertain (${body?.dispatch?.ledgerRunId ?? "receipt pending"}). Check the ledgers before retrying.`
            : `${body?.error ?? "Retention dispatch failed."} Check the ledgers before retrying.`,
      )
    } catch {
      setQueued(true)
      setMessage(
        "Retention dispatch could not be confirmed. Check the ledgers before retrying.",
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        disabled={pending || queued}
        onClick={trigger}
        className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-sm bg-[var(--color-brand)] px-3 text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        <RefreshCcw className="h-4 w-4" strokeWidth={1.5} />
        {pending ? "Starting cleanup" : "Run expired-data cleanup"}
      </button>
      <span className="max-w-xl text-[12px] text-[var(--color-text-muted)]">
        Runs one bounded pass on records whose stored expiry has passed. It does
        not shorten existing expiry dates or release PostgreSQL files.
      </span>
      {message ? (
        <span role="status" className="text-[12px]">
          {message}
        </span>
      ) : null}
    </div>
  )
}
