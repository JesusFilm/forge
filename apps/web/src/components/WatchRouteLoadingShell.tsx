"use client"

import { useTranslations } from "next-intl"

// Loading-only stand-in for the Watch header. It deliberately does not reuse
// `WatchChromeShell`: that component is a server component that imports the
// language corpus via `@/lib/locale`, and a loading fallback has no need to
// pull that into the client bundle or mount the search/feedback providers.
export function WatchRouteLoadingShell() {
  const t = useTranslations("ExperienceSkeleton")

  return (
    <div className="min-h-screen bg-black text-white">
      <div
        aria-hidden="true"
        className="fixed inset-x-0 top-0 z-50 h-20 border-b border-white/5 bg-black/60 backdrop-blur-md"
      >
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-6 px-6 md:px-12">
          <div className="h-8 w-28 animate-pulse rounded bg-stone-800" />
          <div className="hidden h-10 max-w-xl flex-1 animate-pulse rounded-full bg-stone-800 md:block" />
          <div className="size-10 animate-pulse rounded-full bg-stone-800" />
        </div>
      </div>
      <div
        role="status"
        aria-busy="true"
        aria-label={t("loadingContent")}
        className="mx-auto min-h-screen max-w-7xl px-6 pt-28 md:px-12"
      >
        <div aria-hidden="true" className="flex flex-col gap-8 py-12">
          <div className="h-10 w-1/2 animate-pulse rounded bg-stone-800" />
          <div className="h-56 w-full animate-pulse rounded-lg bg-stone-800" />
          <div className="h-48 w-full animate-pulse rounded-lg bg-stone-800" />
        </div>
      </div>
    </div>
  )
}
