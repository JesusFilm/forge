"use client"

import { RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center px-6 py-16">
      <div className="w-full max-w-[34rem] rounded-[2rem] border border-border bg-card px-8 py-10 text-center shadow-[0_24px_56px_rgba(8,8,8,0.08)]">
        <span className="block text-[15px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Studio UI
        </span>
        <h2 className="mt-4 text-[32px] font-semibold tracking-[-0.03em] text-foreground">
          Something went wrong
        </h2>
        <p className="mt-3 text-[18px] leading-7 tracking-[-0.02em] text-muted-foreground">
          {error.message || "An unexpected error occurred."}
        </p>
        <Button className="mt-6" variant="primary" onClick={reset}>
          <RotateCcw aria-hidden="true" />
          Try again
        </Button>
      </div>
    </div>
  )
}
