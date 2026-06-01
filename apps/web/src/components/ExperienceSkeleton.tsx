import { useTranslations } from "next-intl"

export function ExperienceSkeleton() {
  const t = useTranslations("ExperienceSkeleton")
  // Use <div> not <main>: this is a transient Suspense fallback that can
  // coexist briefly with the resolved page's real <main> during streaming,
  // which would give the document two <main> landmarks. The real page
  // owns the <main>; the skeleton is just a placeholder.
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t("loadingContent")}
      className="min-h-screen bg-stone-900"
    >
      {/* Hero placeholder */}
      <div className="relative h-screen w-full animate-pulse bg-stone-800 md:h-[70vh]">
        <div className="absolute bottom-8 left-6 right-6 flex flex-col gap-3 md:left-12 md:right-12">
          <div className="h-10 w-2/3 rounded bg-stone-700 md:h-14" />
          <div className="h-4 w-1/3 rounded bg-stone-700" />
          <div className="mt-2 h-12 w-40 rounded bg-stone-700" />
        </div>
      </div>

      {/* Content block placeholders */}
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-12 md:px-12">
        <div className="h-64 w-full animate-pulse rounded-lg bg-stone-800" />
        <div className="h-48 w-full animate-pulse rounded-lg bg-stone-800" />
        <div className="h-56 w-full animate-pulse rounded-lg bg-stone-800" />
      </div>
    </div>
  )
}
