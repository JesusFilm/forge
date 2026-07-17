/**
 * R7's language-rotation policy as a pure function: consecutive excerpts within a
 * chapter play different languages where available. Identity is `language.slug` and
 * NEVER bcp47 — bcp47 collides in this catalog (ko/ko-kmr, en/en-nai).
 */

import { pickLocalizedName } from "../pickLocalizedName"

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

export type RotationState = {
  /** Slugs already spent in this chapter; reset when a video exhausts them. */
  readonly usedSlugs: readonly string[]
  /** The last chosen slug — excluded even across a reset, so en,en can't happen. */
  readonly previousSlug: string | null
}

export const initialRotationState: RotationState = {
  usedSlugs: [],
  previousSlug: null,
}

type PlayableDub = ShowcaseLanguagePick & { languageSlug: string | null }

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
 * Pick this excerpt's dub, preferring a language the chapter has not spent yet.
 * Returns null when the video has nothing playable, so the caller skips the item
 * down R16's ladder rather than surfacing an error.
 */
export function rotateLanguage(
  dubs: readonly ShowcaseDubInput[] | null | undefined,
  state: RotationState,
): { pick: ShowcaseLanguagePick; nextState: RotationState } | null {
  const playable = playableDubs(dubs)
  if (playable.length === 0) return null

  const withSlug = playable.filter((dub) => dub.languageSlug != null)
  const used = new Set(state.usedSlugs)

  const fresh = withSlug.filter(
    (dub) =>
      !used.has(dub.languageSlug!) && dub.languageSlug !== state.previousSlug,
  )
  const unspentElsewhere = withSlug.filter(
    (dub) => dub.languageSlug !== state.previousSlug,
  )

  // Tier 3 is reached only by a single-language or slug-less video, which is
  // exactly where AE4 says to claim nothing.
  const exhausted = fresh.length === 0
  const chosen = fresh[0] ?? unspentElsewhere[0] ?? playable[0]!

  const distinctSlugs = new Set(withSlug.map((dub) => dub.languageSlug!)).size
  const claimsLanguage =
    distinctSlugs >= 2 &&
    chosen.languageSlug != null &&
    chosen.languageSlug !== state.previousSlug &&
    chosen.languageName != null

  const slug = chosen.languageSlug
  const nextUsed = slug
    ? exhausted
      ? [slug]
      : [...new Set([...state.usedSlugs, slug])]
    : state.usedSlugs

  return {
    pick: { ...chosen, claimsLanguage },
    nextState: { usedSlugs: nextUsed, previousSlug: slug ?? null },
  }
}
