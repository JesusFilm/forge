import { LoaderCircle } from "lucide-react"

export function RouteLoadingFeedback({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className="route-feedback-enter fixed right-4 bottom-4 z-50 w-[min(320px,calc(100vw-2rem))] rounded-sm border border-[var(--color-hairline-strong)] bg-[var(--color-surface)] p-3 shadow-[0_16px_40px_rgba(0,0,0,0.38)]"
    >
      <div className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase text-[var(--color-success)]">
        <LoaderCircle
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin"
          strokeWidth={1.5}
        />
        {label}
      </div>
      <div
        aria-hidden="true"
        className="mt-3 grid h-1 grid-cols-5 gap-1 overflow-hidden"
      >
        <span className="rounded-full bg-[var(--color-success)]" />
        <span className="animate-pulse rounded-full bg-[var(--color-success)]" />
        <span className="animate-pulse rounded-full bg-[var(--color-success)] opacity-70" />
        <span className="rounded-full bg-[var(--color-hairline-strong)]" />
        <span className="rounded-full bg-[var(--color-hairline-strong)]" />
      </div>
    </div>
  )
}
