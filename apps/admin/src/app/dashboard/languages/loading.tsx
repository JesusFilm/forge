import { LoaderCircle } from "lucide-react"

function SkeletonLine({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block rounded-sm bg-[var(--color-surface-raised)] ${className}`}
    />
  )
}

export default function LanguagesLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading language diagnostics"
      className="flex flex-col gap-6"
    >
      <div className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase text-[var(--color-success)]">
        <LoaderCircle
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin"
          strokeWidth={1.5}
        />
        Loading language diagnostics
      </div>

      <div className="flex flex-col gap-3">
        <SkeletonLine className="h-3 w-28" />
        <SkeletonLine className="h-7 w-64 max-w-full" />
        <SkeletonLine className="h-4 w-[460px] max-w-full" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="app-card flex flex-col gap-3 p-4">
            <SkeletonLine className="h-3 w-28" />
            <SkeletonLine className="h-7 w-16" />
            <SkeletonLine className="h-3 w-24" />
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
        <div className="flex flex-col gap-6">
          <section className="app-card overflow-hidden">
            <div className="hairline-strong-b flex items-center justify-between px-4 py-3">
              <SkeletonLine className="h-3 w-40" />
              <SkeletonLine className="h-3 w-32" />
            </div>
            <div className="space-y-3 p-4">
              <SkeletonLine className="h-10 w-full" />
              {Array.from({ length: 6 }, (_, index) => (
                <div
                  key={index}
                  className="grid gap-3 rounded-sm border border-[var(--color-hairline)] p-3 md:grid-cols-[minmax(0,1fr)_160px_120px]"
                >
                  <SkeletonLine className="h-5 w-64 max-w-full" />
                  <SkeletonLine className="h-5 w-32" />
                  <SkeletonLine className="h-5 w-24" />
                </div>
              ))}
            </div>
          </section>

          <section className="app-card overflow-hidden">
            <div className="hairline-strong-b px-4 py-3">
              <SkeletonLine className="h-3 w-32" />
            </div>
            <div className="grid gap-3 p-4 md:grid-cols-3">
              {Array.from({ length: 3 }, (_, index) => (
                <SkeletonLine key={index} className="h-24 w-full" />
              ))}
            </div>
          </section>
        </div>

        <aside className="app-card flex flex-col gap-3 p-4">
          <SkeletonLine className="h-3 w-32" />
          <SkeletonLine className="h-20 w-full" />
          <SkeletonLine className="h-7 w-28" />
          <SkeletonLine className="h-7 w-36" />
        </aside>
      </div>
    </div>
  )
}
