"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { RefreshCcw } from "lucide-react"

type TriggerState = {
  status: "idle" | "queued" | "error"
  message: string | null
}

export function CoreSyncTriggerButton() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [state, setState] = useState<TriggerState>({
    status: "idle",
    message: null,
  })

  async function startSync() {
    setState({ status: "idle", message: null })

    try {
      const response = await fetch("/api/core-sync/manual", {
        method: "POST",
        headers: { accept: "application/json" },
      })
      const body = (await response.json().catch(() => null)) as {
        dispatch?: { runId?: string }
        error?: string
      } | null

      if (!response.ok) {
        setState({
          status: "error",
          message: body?.error ?? "Core Sync dispatch failed.",
        })
        return
      }

      setState({
        status: "queued",
        message: body?.dispatch?.runId
          ? `Queued ${body.dispatch.runId}`
          : "Queued",
      })
      startTransition(() => router.refresh())
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Core Sync dispatch failed.",
      })
    }
  }

  const disabled = isPending || state.status === "queued"

  return (
    <div className="flex flex-col items-start gap-1 md:items-end">
      <button
        type="button"
        disabled={disabled}
        onClick={startSync}
        className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-sm bg-[var(--color-brand)] px-3 text-[13px] font-medium text-white transition-all duration-[120ms] ease-out hover:bg-[var(--color-brand-pressed)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <RefreshCcw
          className={isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"}
          strokeWidth={1.5}
        />
        {isPending ? "Starting" : "Start Sync"}
      </button>
      {state.message ? (
        <span
          className={
            state.status === "error"
              ? "font-mono text-[10px] text-[var(--color-danger)]"
              : "font-mono text-[10px] text-[var(--color-success)]"
          }
        >
          {state.message}
        </span>
      ) : null}
    </div>
  )
}
