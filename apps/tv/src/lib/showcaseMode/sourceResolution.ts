/**
 * KTD-4: ONE source-resolution pipeline behind both reel paths. Curated parses the
 * Showcase Experience's MediaCollection sections (KTD-10); fallback composes from the
 * Home pool. Everything but the fetch seam is pure.
 */

import { pickCardImage } from "../cardImage"
import { getWatchHomeDeterministicOffset } from "../watchHome/heroQueue"
import type {
  WatchHomeCard,
  WatchHomeModel,
  WatchHomeVideoInput,
} from "../watchHome/model"
import { pickViewerLanguage, type ShowcaseDubInput } from "./languageRotation"
import type {
  ExcerptWindow,
  ShowcaseChapter,
  ShowcaseExcerpt,
  ShowcaseParseDrops,
  ShowcaseQueue,
  ShowcaseStream,
} from "./types"

/** KTD-10's reserved section title. Compared trimmed + case-folded (see below). */
export const SHOWCASE_STATS_SECTION_TITLE = "showcase-stats"

/** KTD-7's reserved category-label marker for the language chapter. Trimmed + case-folded. */
export const SHOWCASE_LANGUAGES_CATEGORY_LABEL = "showcase-languages"

/** R6's excerpt band: a bounded 20-40s portion of any catalog video. */
export const EXCERPT_MIN_SECONDS = 20
export const EXCERPT_MAX_SECONDS = 40
const LONG_FORM_OFFSET_RATIO = 0.15

/** End credits are dead air on a reel; no excerpt may reach into this tail. */
export const CREDITS_TAIL_SECONDS = 5

const FALLBACK_CHAPTER_ID = "showcase-fallback"
const FALLBACK_EXCERPT_TARGET = 24

// Wire enums (VideoLabel), never display text: heroQueue's shortFilms pool compares
// the normalized `label` ("Short film") — the exact trap `rawLabel` exists to close.
const SHORT_FORM_LABELS = new Set([
  "SHORT_FILM",
  "SEGMENT",
  "TRAILER",
  "EPISODE",
])

// ── Experience parsing (KTD-10) ─────────────────────────────────────

/** Loose base shape so plain literals and gql.tada blocks both parse. */
export type ShowcaseExperienceBlock = { readonly __typename?: string | null }

type ShowcaseExperienceItem = { readonly coreId?: string | null }

/**
 * GET_WATCH_EXPERIENCE aliases MediaCollection's scalars (`mcTitle: title`); a
 * snapshot-deserialized block carries them unaliased. Reading one set only would
 * silently yield undefined titles for the other — so accept both.
 */
type ShowcaseMediaCollectionLike = {
  readonly sectionKey?: string | null
  readonly mcTitle?: string | null
  readonly title?: string | null
  readonly mcSubtitle?: string | null
  readonly subtitle?: string | null
  readonly mcDescription?: string | null
  readonly description?: string | null
  // KTD-7 language-chapter marker; the fragment selects it unaliased, so one name.
  readonly categoryLabel?: string | null
  readonly items?: readonly ShowcaseExperienceItem[] | null
}

// KTD10: coreIds ride as a $coreIds variable, but validate before hydrating anyway.
const CORE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
function isValidCoreId(coreId: string | null | undefined): coreId is string {
  return typeof coreId === "string" && CORE_ID_PATTERN.test(coreId)
}

function blockText(...candidates: (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim()
    }
  }
  return ""
}

/**
 * The reel is full-bleed, so poster intent — Home's rails use "card". Built here
 * rather than through normalizeCard for that reason (and the reel needs no meta chips).
 */
function videoToExcerpt(
  video: WatchHomeVideoInput,
  chapterId: string,
): ShowcaseExcerpt | null {
  const coreId = video.coreId
  const slug = video.slug
  if (!coreId || !slug) return null // the per-video stream query keys on slug
  return {
    id: `${chapterId}:${coreId}`,
    coreId,
    slug,
    title: video.locales?.[0]?.title ?? slug,
    posterUrl: pickCardImage(video.images ?? [], "poster"),
    rawLabel: video.label ?? null,
  }
}

function isStatsSection(title: string): boolean {
  // The discriminator is the TITLE (admin auto-generates sectionKeys with no UI to
  // set them), so fold case — a curator's slip must not leak stats as a chapter.
  return title.toLowerCase() === SHOWCASE_STATS_SECTION_TITLE
}

function isLanguageSection(categoryLabel: string): boolean {
  // Sibling to isStatsSection: the marker is curator-authored, so fold case — a
  // casing/whitespace slip must not fail to designate the language chapter.
  return categoryLabel.toLowerCase() === SHOWCASE_LANGUAGES_CATEGORY_LABEL
}

function parseStatLines(description: string | null | undefined): string[] {
  if (!description) return []
  return description
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/**
 * Split the Experience's top-level MediaCollection sections into felt-need chapters
 * plus the reserved stats lines. Drops an item whose coreId does not hydrate and a
 * chapter left with zero excerpts, mirroring the Home adapter's rules.
 */
export function parseShowcaseExperience(
  blocks: readonly ShowcaseExperienceBlock[] | null | undefined,
  videoByCoreId: Map<string, WatchHomeVideoInput>,
): {
  chapters: ShowcaseChapter[]
  statLines: string[]
  drops: ShowcaseParseDrops
} {
  const chapters: ShowcaseChapter[] = []
  const statLines: string[] = []
  const drops: ShowcaseParseDrops = {
    items: 0,
    chapters: 0,
    extraLanguageMarkers: 0,
  }
  // R3: exactly one language chapter — the FIRST surviving marked section claims it.
  let languageChapterAssigned = false

  // Top level only: KTD-10 authors one MediaCollection per chapter at the root.
  ;(blocks ?? []).forEach((block, index) => {
    if (block.__typename !== "MediaCollectionBlock") return
    const media = block as ShowcaseMediaCollectionLike
    const title = blockText(media.mcTitle, media.title)

    if (isStatsSection(title)) {
      statLines.push(
        ...parseStatLines(media.mcDescription ?? media.description),
      )
      return
    }

    const chapterId = media.sectionKey ?? `showcase-chapter-${index}`
    const authored = (media.items ?? []).length
    const excerpts = (media.items ?? [])
      .map((item) =>
        isValidCoreId(item.coreId)
          ? (videoByCoreId.get(item.coreId) ?? null)
          : null,
      )
      .map((video) => (video ? videoToExcerpt(video, chapterId) : null))
      .filter((excerpt): excerpt is ShowcaseExcerpt => excerpt != null)
    drops.items += authored - excerpts.length

    if (excerpts.length === 0) {
      // A section the curator authored that reaches no TV — the drop they most
      // need told about, and the one with no other signal.
      if (authored > 0) drops.chapters += 1
      return
    }
    const chapter: ShowcaseChapter = {
      id: chapterId,
      title,
      subtitle: blockText(media.mcSubtitle, media.subtitle) || null,
      excerpts,
    }
    if (isLanguageSection(blockText(media.categoryLabel))) {
      // AE7: the first marked chapter wins; a later one plays as an ordinary chapter,
      // its designation discarded and surfaced to the curator via the drops accounting.
      if (!languageChapterAssigned) {
        languageChapterAssigned = true
        chapter.languageChapter = { centerpieceExcerptId: excerpts[0].id }
      } else {
        drops.extraLanguageMarkers += 1
      }
    }
    chapters.push(chapter)
  })

  return { chapters, statLines, drops }
}

/** The unique, validated coreIds the Showcase Experience references (top-up input). */
export function showcaseExperienceCoreIds(
  blocks: readonly ShowcaseExperienceBlock[] | null | undefined,
): string[] {
  const ids: string[] = []
  ;(blocks ?? []).forEach((block) => {
    if (block.__typename !== "MediaCollectionBlock") return
    for (const item of (block as ShowcaseMediaCollectionLike).items ?? []) {
      if (isValidCoreId(item.coreId)) ids.push(item.coreId)
    }
  })
  return [...new Set(ids)]
}

// ── Fallback composition (R5) ───────────────────────────────────────

function cardToExcerpt(card: WatchHomeCard): ShowcaseExcerpt | null {
  if (!card.slug) return null
  return {
    id: `${FALLBACK_CHAPTER_ID}:${card.coreId}`,
    coreId: card.coreId,
    slug: card.slug,
    title: card.title,
    // Landscape-first: the reel is full-bleed 16:9, and on a poster rail `imageUrl`
    // is a curated 2:3 poster that contentFit="cover" would crop to a sliver.
    posterUrl: card.landscapeImageUrl ?? card.imageUrl,
    rawLabel: card.rawLabel,
  }
}

/** Day-seeded rotation so an office TV doesn't replay one fixed order forever. */
function rotateByDay<T>(items: readonly T[], poolId: string, now: Date): T[] {
  if (items.length === 0) return []
  const offset = getWatchHomeDeterministicOffset(poolId, items.length, { now })
  return [...items.slice(offset), ...items.slice(0, offset)]
}

/**
 * R5: compose the reel from the already-fetched Home pool when no Showcase Experience
 * is usable. One unlabeled chapter — the fallback path shows no felt-need cards and no
 * interstitials — short-form first, longer items as backfill so AE1 always has content.
 */
export function buildFallbackChapters(args: {
  model: WatchHomeModel
  now?: Date
}): ShowcaseChapter[] {
  const now = args.now ?? new Date()
  const byCoreId = new Map<string, WatchHomeCard>()
  for (const card of [
    ...args.model.featured,
    ...args.model.sections.flatMap((section) => section.cards),
  ]) {
    if (!byCoreId.has(card.coreId)) byCoreId.set(card.coreId, card)
  }

  const excerpts = [...byCoreId.values()]
    .map(cardToExcerpt)
    .filter((excerpt): excerpt is ShowcaseExcerpt => excerpt != null)
  const isShortForm = (excerpt: ShowcaseExcerpt) =>
    excerpt.rawLabel != null && SHORT_FORM_LABELS.has(excerpt.rawLabel)

  const ordered = [
    ...rotateByDay(
      excerpts.filter(isShortForm),
      `${FALLBACK_CHAPTER_ID}-short`,
      now,
    ),
    ...rotateByDay(
      excerpts.filter((excerpt) => !isShortForm(excerpt)),
      `${FALLBACK_CHAPTER_ID}-long`,
      now,
    ),
  ].slice(0, FALLBACK_EXCERPT_TARGET)

  if (ordered.length === 0) return []
  return [
    { id: FALLBACK_CHAPTER_ID, title: "", subtitle: null, excerpts: ordered },
  ]
}

// ── The ladder (R5/R16) ─────────────────────────────────────────────

export type ShowcaseExperienceOutcome = "present" | "absent" | "error"

export type ShowcaseFallbackReason =
  | "experience-absent"
  | "experience-empty"
  | "experience-error"
  | "experience-error-recovered"

export type ShowcaseSourceInput = {
  experienceOutcome: ShowcaseExperienceOutcome
  experienceChapters: ShowcaseChapter[]
  experienceStatLines: string[]
  fallbackChapters: ShowcaseChapter[]
}

export type ShowcaseSourceOutput =
  | { kind: "stills"; logs: ShowcaseFallbackReason[] }
  | { kind: "queue"; queue: ShowcaseQueue; logs: ShowcaseFallbackReason[] }

/**
 * R5/R16 as a pure function, mirroring reconcileWatchHome: Experience → pool → stills.
 * Never an error result — stills is the floor, and it is reached only when BOTH
 * sources yield nothing.
 */
export function resolveShowcaseSource(
  input: ShowcaseSourceInput,
): ShowcaseSourceOutput {
  if (input.experienceChapters.length >= 1) {
    return {
      kind: "queue",
      queue: {
        kind: "curated",
        chapters: input.experienceChapters,
        statLines: input.experienceStatLines,
      },
      // Chapters over a failed fetch means a last-good Experience was reused.
      logs:
        input.experienceOutcome === "error"
          ? ["experience-error-recovered"]
          : [],
    }
  }

  const logs: ShowcaseFallbackReason[] = [
    input.experienceOutcome === "error"
      ? "experience-error"
      : input.experienceOutcome === "absent"
        ? "experience-absent"
        : "experience-empty",
  ]

  if (input.fallbackChapters.length === 0) return { kind: "stills", logs }
  // Authored stats describe the curated reel; they must not ride the pool reel.
  return {
    kind: "queue",
    queue: {
      kind: "fallback",
      chapters: input.fallbackChapters,
      statLines: [],
    },
    logs,
  }
}

// ── Excerpt windows (R6) ────────────────────────────────────────────

/**
 * One deterministic window per item: short-form from 0, longer ~15% in under the
 * poster hold, unknown duration still capped. Every window stops short of the credits
 * tail — except under ~25s, where clearing it would dip below MIN, so the item plays out.
 */
export function resolveExcerptWindow(
  durationSeconds: number | null | undefined,
): ExcerptWindow {
  if (
    durationSeconds == null ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    return { startSeconds: 0, endSeconds: EXCERPT_MAX_SECONDS }
  }
  // Floored, so a fractional duration can't round the end back into the tail.
  const creditsFreeEnd = Math.floor(durationSeconds - CREDITS_TAIL_SECONDS)
  if (durationSeconds <= EXCERPT_MAX_SECONDS) {
    return {
      startSeconds: 0,
      endSeconds:
        creditsFreeEnd >= EXCERPT_MIN_SECONDS
          ? creditsFreeEnd
          : Math.round(durationSeconds),
    }
  }
  // duration > MAX here, so the window is min(MAX, 0.85 * duration - 5) >= 29s —
  // inside the 20-40s band without a clamp, and always clear of the tail.
  const startSeconds = Math.round(durationSeconds * LONG_FORM_OFFSET_RATIO)
  return {
    startSeconds,
    endSeconds: Math.min(startSeconds + EXCERPT_MAX_SECONDS, creditsFreeEnd),
  }
}

// ── Playable stream resolution (injectable fetch seam) ──────────────

export type ShowcaseVideoDubs = {
  readonly dubs: readonly ShowcaseDubInput[] | null | undefined
}

/** Injected so every pure test above stays network-free (showcaseVideoQuery.ts binds it). */
export type FetchShowcaseVideo = (
  slug: string,
) => Promise<ShowcaseVideoDubs | null>

/**
 * Resolve one ordinary excerpt's playable stream in the viewer's chosen language (or the
 * default chain) plus its window. Returns null on ANY failure (fetch throw, missing video,
 * nothing playable) so R16's ladder skips the item rather than surfacing an error.
 */
export async function resolveExcerptStream(args: {
  excerpt: ShowcaseExcerpt
  viewerLanguageSlug: string | null
  fetchVideo: FetchShowcaseVideo
}): Promise<ShowcaseStream | null> {
  let video: ShowcaseVideoDubs | null
  try {
    video = await args.fetchVideo(args.excerpt.slug)
  } catch {
    return null
  }
  if (!video) return null

  const pick = pickViewerLanguage(video.dubs, args.viewerLanguageSlug)
  if (!pick) return null

  return {
    hls: pick.hls,
    languageSlug: pick.languageSlug,
    languageName: pick.languageName,
    muxPlaybackId: pick.muxPlaybackId,
    // The DUB's duration is what actually plays — Video.durationSeconds is the
    // primary language's and drifts per dub.
    window: resolveExcerptWindow(pick.durationSeconds),
    claimsLanguage: pick.claimsLanguage,
  }
}
