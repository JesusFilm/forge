"use client"

import { Copy } from "lucide-react"
import type { Route as NextRoute } from "next"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"

export type DuplicateActionResult = {
  ok: boolean
  error?: string
  href?: string
}

export function DuplicateExperienceControl({
  action,
  dirty,
  externalPending,
  onError,
}: {
  action: () => Promise<DuplicateActionResult>
  dirty: boolean
  externalPending: boolean
  onError: (message: string) => void
}) {
  const router = useRouter()
  const mountedRef = useRef(true)
  const inFlightRef = useRef(false)
  const [phase, setPhase] = useState<"idle" | "duplicating" | "navigating">(
    "idle",
  )
  const [isTransitionPending, startTransition] = useTransition()

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const busy =
    phase !== "idle" || isTransitionPending || externalPending || dirty
  const statusLabel =
    phase === "duplicating"
      ? "Duplicating…"
      : phase === "navigating"
        ? "Opening…"
        : "Duplicate"

  return (
    <span
      className="inline-flex"
      tabIndex={dirty ? 0 : undefined}
      aria-label={dirty ? "Duplicate unavailable" : undefined}
      aria-describedby={dirty ? "duplicate-experience-save-first" : undefined}
    >
      <button
        type="button"
        onClick={() => {
          if (inFlightRef.current || externalPending || dirty) return
          inFlightRef.current = true
          setPhase("duplicating")
          startTransition(async () => {
            try {
              const result = await action()
              if (!mountedRef.current) return
              if (!result.ok || !result.href) {
                onError(result.error ?? "Unable to duplicate experience.")
                inFlightRef.current = false
                setPhase("idle")
                return
              }
              setPhase("navigating")
              router.push(result.href as NextRoute)
            } catch {
              if (!mountedRef.current) return
              onError("Unable to duplicate experience.")
              inFlightRef.current = false
              setPhase("idle")
            }
          })
        }}
        disabled={busy}
        aria-busy={phase !== "idle" || undefined}
        aria-describedby={dirty ? "duplicate-experience-save-first" : undefined}
        className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-[2px] border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 text-[12px] font-medium text-[var(--color-text-primary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-60"
        title={
          dirty
            ? "Save your changes before duplicating."
            : phase === "duplicating"
              ? "Duplicating experience"
              : phase === "navigating"
                ? "Opening duplicated experience"
                : externalPending
                  ? "Wait for the pending editor action to finish"
                  : "Duplicate this experience as a draft"
        }
      >
        <Copy className="h-4 w-4" strokeWidth={1.5} />
        {statusLabel}
      </button>
      {dirty ? (
        <span id="duplicate-experience-save-first" className="sr-only">
          Save your changes before duplicating.
        </span>
      ) : null}
    </span>
  )
}
