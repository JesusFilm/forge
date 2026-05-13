import type { Metadata } from "next"
import { DEFAULT_LOCALE, isLocale } from "@/lib/locale"
import { isWatchPageMissingError, resolveWatchPage } from "@/lib/content"
import { getWatchPageMetadata } from "@/lib/experience-metadata"
import { SectionRenderer, type Section } from "@/components/sections"
import { ExperienceEmpty } from "@/components/ExperienceEmpty"
import { ExperienceError } from "@/components/ExperienceError"
import { MaintenanceFallback } from "@/components/MaintenanceFallback"
import { env } from "@/env"

export const revalidate = 60

// Parsed once at module scope — per-request reads via headers()/cookies()
// would disable Next's Full Route Cache.
// See docs/solutions/web/nextjs-headers-defeats-route-cache.md.
const DISABLED_ROUTES: ReadonlySet<string> = (() => {
  const raw = env.FORGE_DISABLE_WATCH_ROUTES
  if (raw == null || raw === "") return new Set()
  const entries = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  // Warn on entries missing the leading `/` so operators see the typo in
  // deploy logs rather than shipping a silently-non-matching flag.
  const malformed = entries.filter((s) => !s.startsWith("/"))
  if (malformed.length > 0 && typeof console !== "undefined") {
    console.warn(
      `[slug-page] FORGE_DISABLE_WATCH_ROUTES entries do not start with "/" (${malformed.join(", ")}); these will not match any slug. Expected format: "/some-slug,/another-slug".`,
    )
  }
  return new Set(entries)
})()

type PageProps = {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params

  // If slug is a locale (e.g. /watch/en), let the homepage handle metadata.
  if (isLocale(slug)) return {}

  return getWatchPageMetadata(DEFAULT_LOCALE, { slug, pathPrefix: "watch" })
}

export default async function SlugPage({ params }: PageProps) {
  const { slug } = await params

  // Emergency rollback — short-circuit before any data fetch.
  if (DISABLED_ROUTES.has(`/${slug}`)) {
    return <MaintenanceFallback />
  }

  const locale = isLocale(slug) ? slug : DEFAULT_LOCALE

  const result = await resolveWatchPage(
    locale,
    isLocale(slug) ? undefined : slug,
  )

  if (result.error) {
    if (isWatchPageMissingError(result.error)) {
      return <ExperienceEmpty />
    }
    return <ExperienceError message={result.error.message} />
  }

  const page = result.data
  const experience =
    page?.kind === "video-template" ? page.template : (page?.experience ?? null)
  const routeVideo = page?.kind === "video-template" ? page.routeVideo : null
  const blocks = (experience?.blocks ?? []).filter(
    (b): b is Section => b !== null && b.__typename !== "Error",
  )
  if (!blocks.length) {
    return <ExperienceEmpty />
  }

  return (
    <main className="min-h-screen bg-stone-900">
      {blocks.map((block, i) => {
        const key =
          "id" in block && typeof block.id === "string"
            ? block.id
            : `block-${i}`
        return (
          <SectionRenderer key={key} section={block} routeVideo={routeVideo} />
        )
      })}
    </main>
  )
}
