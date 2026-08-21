"use client"

import { useEffect, useRef } from "react"
import { PrimaryButton } from "@/components/admin-ui"

export default function UserPlaylistModerationError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const alertRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    alertRef.current?.focus()
  }, [])

  return (
    <div ref={alertRef} role="alert" tabIndex={-1} className="app-card p-6">
      <h1 className="text-lg font-semibold">
        Moderation queue is temporarily unavailable
      </h1>
      <p className="mt-2 text-[13px] text-[var(--color-text-muted)]">
        No moderation data was changed. Try loading the queue again.
      </p>
      <PrimaryButton className="mt-4" onClick={reset}>
        Try again
      </PrimaryButton>
    </div>
  )
}
