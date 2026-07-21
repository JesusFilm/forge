/**
 * KTD-3's ordinary-excerpt language policy as a pure function: every non-centerpiece
 * excerpt (curated AND fallback reels) plays the viewer's chosen audio language, or the
 * default chain when they have none / it has no playable dub here. Identity is
 * `language.slug` and NEVER bcp47 — bcp47 collides in this catalog (ko/ko-kmr, en/en-nai).
 */

import { pickLocalizedName } from "../pickLocalizedName"
import { resolveDefaultSlug } from "../resolveDefaultLanguage"

/**
 * Structural shape of one dub, loose so tests pass literals and the caller can pass
 * the gql.tada `variants: dubs` result straight through (showcaseVideoQuery.ts).
 */
export type ShowcaseDubInput = {
  readonly published?: boolean | null
  readonly hls?: string | null
  readonly duration?: number | null
  readonly language?: {
    readonly slug?: string | null
    readonly bcp47?: string | null
    // Admin's jsonb locale map, typed `unknown` by gql.tada — never render raw.
    readonly name?: unknown
  } | null
  readonly muxVideo?: { readonly playbackId?: string | null } | null
}

export type ShowcaseLanguagePick = {
  hls: string
  durationSeconds: number | null
  languageSlug: string | null
  languageName: string | null
  muxPlaybackId: string | null
  claimsLanguage: boolean
}

// bcp47 rides the internal playable dub only — the default chain's device-locale and
// English rungs match on it, but a pick never exposes it (identity stays languageSlug).
type PlayableDub = ShowcaseLanguagePick & { bcp47: string | null }

// normalizeVideo.ts's contract: an empty-string hls is NOT playable.
function toPlayable(dub: ShowcaseDubInput): PlayableDub | null {
  if (dub.published !== true) return null
  const hls = dub.hls
  if (hls == null || hls === "") return null
  const slug = dub.language?.slug ?? null
  return {
    hls,
    durationSeconds: dub.duration ?? null,
    languageSlug: slug && slug.length > 0 ? slug : null,
    bcp47: dub.language?.bcp47 ?? null,
    languageName: dub.language?.name
      ? (pickLocalizedName(dub.language.name) ?? null)
      : null,
    muxPlaybackId: dub.muxVideo?.playbackId ?? null,
    claimsLanguage: false,
  }
}

export function playableDubs(
  dubs: readonly ShowcaseDubInput[] | null | undefined,
): PlayableDub[] {
  return (dubs ?? [])
    .map(toPlayable)
    .filter((dub): dub is PlayableDub => dub != null)
}

/**
 * Adapt slug-bearing playable dubs into resolveDefaultSlug's option shape. Slug-less
 * dubs must be filtered out first — they carry no identity to resolve back to.
 */
export function toDefaultSlugOptions(
  dubs: readonly (PlayableDub & { languageSlug: string })[],
): { slug: string; bcp47: string | null; languageSlug: string }[] {
  return dubs.map((dub) => ({
    slug: dub.languageSlug,
    bcp47: dub.bcp47,
    languageSlug: dub.languageSlug,
  }))
}

/**
 * Pick this excerpt's dub for the viewer's chosen audio language. An exact `language.slug`
 * match among the playable dubs wins; failing that (no preference, or none playable in it)
 * the default chain resolves it (device locale → English → first). `claimsLanguage` is
 * always false — an ordinary excerpt does not rotate, so the lower-third claims nothing.
 * Returns null when the video has nothing playable, so the caller skips the item down
 * R16's ladder rather than surfacing an error.
 */
export function pickViewerLanguage(
  dubs: readonly ShowcaseDubInput[] | null | undefined,
  viewerSlug: string | null,
): ShowcaseLanguagePick | null {
  const playable = playableDubs(dubs)
  if (playable.length === 0) return null

  if (viewerSlug != null) {
    const exact = playable.find((dub) => dub.languageSlug === viewerSlug)
    if (exact) return exact
  }

  // The video's primary-language bcp47 is not in the lean per-video query, so that rung
  // gets null; the device-locale, English, and first rungs stand in. Slug-less dubs can't
  // be an option (no identity to return), so an all-slug-less video falls to playable[0].
  const chosenSlug = resolveDefaultSlug(
    toDefaultSlugOptions(
      playable.filter(
        (dub): dub is PlayableDub & { languageSlug: string } =>
          dub.languageSlug != null,
      ),
    ),
    null,
  )
  return playable.find((dub) => dub.languageSlug === chosenSlug) ?? playable[0]!
}
