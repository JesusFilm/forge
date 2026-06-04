import { LoaderCircle } from "lucide-react"

function SkeletonLine({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block rounded-sm bg-[var(--color-surface-raised)] ${className}`}
    />
  )
}

export default function DashboardLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading dashboard"
      className="flex min-w-0 flex-col gap-6"
    >
      <div className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase text-[var(--color-success)]">
        <LoaderCircle
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin"
          strokeWidth={1.5}
        />
        Loading dashboard
      </div>

      <div className="flex flex-col gap-3">
        <SkeletonLine className="h-3 w-28" />
        <SkeletonLine className="h-7 w-64 max-w-full" />
        <SkeletonLine className="h-4 w-[420px] max-w-full" />
      </div>

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="app-card flex flex-col gap-3 p-4">
            <SkeletonLine className="h-3 w-24" />
            <SkeletonLine className="h-7 w-20" />
            <SkeletonLine className="h-3 w-28" />
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="app-card overflow-hidden">
          <div className="hairline-strong-b flex items-center justify-between px-4 py-3">
            <SkeletonLine className="h-3 w-32" />
            <SkeletonLine className="h-3 w-20" />
          </div>
          <div className="divide-y divide-[var(--color-hairline)]">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="grid gap-3 px-4 py-4 md:grid-cols-4">
                <SkeletonLine className="h-4 w-40 md:col-span-2" />
                <SkeletonLine className="h-4 w-24" />
                <SkeletonLine className="h-4 w-28" />
              </div>
            ))}
          </div>
        </section>

        <aside className="app-card flex flex-col gap-3 p-4">
          <SkeletonLine className="h-3 w-28" />
          <SkeletonLine className="h-20 w-full" />
          <div className="flex flex-wrap gap-2">
            <SkeletonLine className="h-7 w-24" />
            <SkeletonLine className="h-7 w-28" />
          </div>
        </aside>
      </div>
    </div>
  )
}
