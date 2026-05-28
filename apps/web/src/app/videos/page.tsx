import type { Metadata } from "next"
import { useTranslations } from "next-intl"
import { setRequestLocale } from "next-intl/server"

import { DEFAULT_LOCALE } from "@/lib/locale"
import { WATCH_BASE_PATH, WATCH_CANONICAL_ORIGIN } from "@/lib/routes"

export const revalidate = 60

export const metadata: Metadata = {
  title: "All Videos",
  description: "Browse the full catalog of JesusFilm videos.",
  alternates: {
    canonical: `${WATCH_CANONICAL_ORIGIN}${WATCH_BASE_PATH}/videos`,
  },
}

// Phase 2f MVP: route resolves 200 with a placeholder. Full paginated
// listing (search-backed) lands in a follow-up — the contract this PR
// satisfies is just that /videos is a recognized route, NOT subject to
// the canonicalizer's single-segment-duplicate rule (excluded via
// ONE_SEGMENT_EXEMPT in apps/web/src/lib/url-canonicalize.ts).
export default function VideosPage() {
  setRequestLocale(DEFAULT_LOCALE)
  const t = useTranslations("VideosPage")
  return (
    <main className="min-h-screen bg-stone-900 px-6 py-24 text-stone-100">
      <h1 className="text-3xl font-semibold">{t("title")}</h1>
      <p className="mt-4 max-w-prose text-stone-300">{t("placeholder")}</p>
    </main>
  )
}
