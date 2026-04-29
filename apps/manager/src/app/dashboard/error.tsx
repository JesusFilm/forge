"use client"

import { RotateCcw } from "lucide-react"

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="studio-shell-state">
      <div className="studio-shell-state-card">
        <span className="studio-shell-state-eyebrow">Studio UI</span>
        <h2>Something went wrong</h2>
        <p>{error.message || "An unexpected error occurred."}</p>
        <button className="design-system-button is-primary" onClick={reset}>
          <RotateCcw className="icon" aria-hidden="true" />
          Try again
        </button>
      </div>
    </div>
  )
}
