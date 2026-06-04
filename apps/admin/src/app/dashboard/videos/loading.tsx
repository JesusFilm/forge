import { LoaderCircle } from "lucide-react"

function SkeletonLine({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block rounded-sm bg-[var(--color-surface-raised)] ${className}`}
    />
  )
}

function VideoSkeletonRow({ index }: { index: number }) {
  return (
    <article className="grid gap-4 border-b border-[var(--color-hairline)] px-4 py-4 last:border-b-0 lg:grid-cols-[168px_minmax(0,1fr)_minmax(220px,300px)_104px] lg:items-center">
      <div className="aspect-video w-full rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] sm:w-[168px]" />
      <div className="min-w-0 space-y-3">
        <SkeletonLine className="h-5 w-[min(260px,80%)]" />
        <SkeletonLine className="h-3 w-[min(360px,92%)]" />
      </div>
      <div className="min-w-0 space-y-3">
        <div className="flex items-end justify-between gap-3">
          <SkeletonLine className="h-7 w-28" />
          <SkeletonLine className="h-3 w-10" />
        </div>
        <SkeletonLine className="h-1.5 w-full rounded-full" />
        <div className="flex gap-1.5">
          {Array.from({ length: 4 }, (_, chipIndex) => (
            <SkeletonLine key={`${index}-${chipIndex}`} className="h-6 w-14" />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 lg:flex-col lg:items-end">
        <SkeletonLine className="h-4 w-20" />
        <div className="flex gap-2">
          <SkeletonLine className="h-8 w-8" />
          <SkeletonLine className="h-8 w-8" />
        </div>
      </div>
    </article>
  )
}

export default function VideosLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading video library"
      className="flex min-w-0 flex-col gap-5"
    >
      <div className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase text-[var(--color-success)]">
        <LoaderCircle
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin"
          strokeWidth={1.5}
        />
        Loading video library
      </div>

      <header className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0 space-y-3">
          <SkeletonLine className="h-3 w-28" />
          <SkeletonLine className="h-7 w-56 max-w-full" />
          <SkeletonLine className="h-4 w-[420px] max-w-full" />
        </div>
        <SkeletonLine className="h-8 w-40" />
      </header>

      <section className="flex min-w-0 flex-col gap-3">
        <SkeletonLine className="h-10 w-full" />
        <div className="flex gap-2 overflow-hidden">
          <SkeletonLine className="h-10 w-[168px] shrink-0" />
          <SkeletonLine className="h-10 w-[190px] shrink-0" />
          <SkeletonLine className="h-10 w-[210px] shrink-0" />
        </div>
      </section>

      <section className="app-card min-w-0 overflow-hidden">
        {Array.from({ length: 5 }, (_, index) => (
          <VideoSkeletonRow key={index} index={index} />
        ))}
        <div className="flex items-center justify-between border-t border-[var(--color-hairline)] px-4 py-3">
          <SkeletonLine className="h-4 w-40" />
          <SkeletonLine className="h-8 w-48" />
        </div>
      </section>
    </div>
  )
}
