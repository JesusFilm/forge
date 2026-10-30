// Pure helpers for the Watch Share film kit: the recipient-audio link, the
// invitation text, discussion prompts and the real guide sources. Kept free of
// React and `env` so the rules can be tested without a DOM.

import type { WatchLanguagePickerVariant } from "./content"
import { deriveLanguageDisplay } from "./language-display"
import { isPlayableLanguageVariant } from "./playable-variant"
import { markWatchUrlAsShared } from "./playback-discovery"
import { tryAsLocaleSlug } from "./routes"
import { resolveWatchShareUrl } from "./share"

export type WatchShareKitLanguage = {
  slug: string
  name: string
  nativeName: string | null
}

/**
 * The film the Share audience is offering. Supplied by the host page; the kit
 * never fetches film data itself.
 *
 * - `slug` / `languageSlug` identify the page the sender is on.
 * - `languageVariants` is the catalog's real audio inventory for the film
 *   (the same shape the language picker consumes). Only playable variants are
 *   offered to the recipient.
 * - `languageOptionsStatus` lets the kit say honestly when that inventory has
 *   not loaded, instead of implying the film has no other audio.
 */
export type WatchShareFilm = {
  slug: string
  title: string
  languageSlug: string
  languageName?: string | null
  runtimeMinutes?: number | null
  studyQuestions?: readonly string[]
  languageVariants: readonly WatchLanguagePickerVariant[]
  languageOptionsStatus?: "idle" | "loading" | "ready" | "error"
}

/** Canonical, shareable Watch link for one recipient audio language. */
export function buildShareKitLink({
  origin,
  videoSlug,
  languageSlug,
}: {
  origin: string
  videoSlug: string
  languageSlug: string
}): string | null {
  const url = resolveWatchShareUrl({ origin, videoSlug, languageSlug })
  return url ? markWatchUrlAsShared(url) : null
}

/**
 * Audio languages the recipient can be offered. The sender's own language is
 * always first (they are on that page, so it plays); the rest come only from
 * playable catalog variants, deduplicated and sorted by name.
 */
export function resolveShareKitLanguages({
  current,
  variants,
}: {
  current: { slug: string; name?: string | null }
  variants: readonly WatchLanguagePickerVariant[]
}): WatchShareKitLanguage[] {
  const byslug = new Map<string, WatchShareKitLanguage>()
  const currentSlug = tryAsLocaleSlug(current.slug)
  if (currentSlug) {
    const display = deriveLanguageDisplay(currentSlug, current.name)
    byslug.set(currentSlug, {
      slug: currentSlug,
      name: display.name,
      nativeName: display.nativeName,
    })
  }
  for (const variant of variants) {
    if (!isPlayableLanguageVariant(variant)) continue
    const slug = tryAsLocaleSlug(variant.language.slug)
    if (!slug || byslug.has(slug)) continue
    const display = deriveLanguageDisplay(slug, variant.language.name)
    byslug.set(slug, {
      slug,
      name: display.name,
      nativeName: variant.language.nativeName?.trim() || display.nativeName,
    })
  }
  const own = currentSlug ? byslug.get(currentSlug) : undefined
  if (own) byslug.delete(own.slug)
  const others = [...byslug.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  return own ? [own, ...others] : others
}

/** Original starters, used only when a film has no authored study questions. */
export const WATCH_SHARE_KIT_EDITORIAL_PROMPTS = [
  "What stayed with you after watching?",
  "Which moment felt most real to you, and why?",
  "What did you notice about how people responded to Jesus?",
  "Is there anything here you would like to know more about?",
] as const

export type WatchShareKitPrompts = {
  /** `authored` = this film's study questions; `editorial` = our own starters. */
  source: "authored" | "editorial"
  prompts: string[]
}

export function resolveShareKitPrompts(
  studyQuestions: readonly string[] | null | undefined,
): WatchShareKitPrompts {
  const authored = (studyQuestions ?? [])
    .map((question) => question.trim())
    .filter(Boolean)
  return authored.length > 0
    ? { source: "authored", prompts: authored }
    : { source: "editorial", prompts: [...WATCH_SHARE_KIT_EDITORIAL_PROMPTS] }
}

export function buildShareKitInvitation({
  title,
  url,
  runtimeMinutes,
  languageName,
}: {
  title: string
  url: string
  runtimeMinutes: number | null | undefined
  languageName: string
}): string {
  const length = runtimeMinutes ? ` It is about ${runtimeMinutes} minutes.` : ""
  return `I watched “${title}” and thought of you.${length} It plays in ${languageName}, and there is no pressure to watch. ${url}`
}

export type WatchShareKitSource = {
  id: string
  title: string
  publisher: string
  language: string
  summary: string
  pageHref: string
  pdfHref?: string
  /** Date the page and PDF were last checked to resolve (YYYY-MM-DD). */
  verifiedOn: string
}

/**
 * Real Jesus Film Project guides, taken from the published resources index.
 * Metadata only: nothing here describes a guide's contents beyond its own
 * published summary, and no ZIP or email delivery is implied.
 */
export const WATCH_SHARE_KIT_SOURCES: readonly WatchShareKitSource[] = [
  {
    id: "short-film-gathering",
    title: "How to Host a Short Film Gathering",
    publisher: "Jesus Film Project",
    language: "English",
    summary:
      "Use the power of film to enter into meaningful conversations about Jesus by hosting a film event in your community.",
    pageHref:
      "https://www.jesusfilm.org/resources/strategies/outreach/how-to-host-a-short-film-festival/",
    pdfHref:
      "https://www.jesusfilm.org/wp-content/uploads/2025/03/Short-Film-Gathering.pdf",
    verifiedOn: "2026-10-17",
  },
  {
    id: "amazing-question",
    title: "Using “The Amazing Question” to Share Your Faith",
    publisher: "Jesus Film Project",
    language: "English",
    summary:
      "A guide to initiating spiritual conversations, encouraging reflection and revealing deep longings.",
    pageHref:
      "https://www.jesusfilm.org/resources/strategies/outreach/using-the-amazing-question-to-share-your-faith/",
    pdfHref:
      "https://www.jesusfilm.org/wp-content/uploads/2024/09/engAMER-AmazQ-DS-Digital-GloMo-11May23.pdf",
    verifiedOn: "2026-10-17",
  },
]

const SOURCE_HOST = "www.jesusfilm.org"

function isSourceUrl(value: string | undefined, pdf: boolean): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    return (
      url.protocol === "https:" &&
      url.host === SOURCE_HOST &&
      (!pdf || url.pathname.toLowerCase().endsWith(".pdf"))
    )
  } catch {
    return false
  }
}

/** Drops unusable guides, and unusable PDFs, without breaking Share. */
export function resolveShareKitSources(
  sources: readonly WatchShareKitSource[],
): WatchShareKitSource[] {
  return sources.flatMap((source) => {
    if (!isSourceUrl(source.pageHref, false)) return []
    if (source.pdfHref !== undefined && !isSourceUrl(source.pdfHref, true)) {
      const { pdfHref: _dropped, ...rest } = source
      void _dropped
      return [rest]
    }
    return [source]
  })
}
