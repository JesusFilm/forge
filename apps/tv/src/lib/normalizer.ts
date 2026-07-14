// TV-owned typed block seam (the mobile normalizer it was ported from is gone).
// Wire blocks arrive as the gql.tada ResultOf union; models leave as a
// `kind`-discriminated union DERIVED from it, so a fragment/alias change breaks
// here and in the typed renderers at compile time, not as a runtime `undefined`.

import type { AdminResultOf as ResultOf } from "@forge/admin-graphql"

import type { GET_WATCH_EXPERIENCE } from "./queries"

const TYPENAME_TO_KIND = {
  VideoHeroBlock: "videoHero",
  SectionBlock: "sectionWrapper",
  VideoBlock: "video",
  TextBlock: "text",
  RelatedQuestionsBlock: "relatedQuestions",
  BibleQuotesCarouselBlock: "bibleQuotesCarousel",
  ContainerBlock: "container",
  MediaCollectionBlock: "mediaCollection",
  NavigationCarouselBlock: "navigationCarousel",
  VideoCarouselBlock: "videoCarousel",
  QuizButtonBlock: "quizButton",
  EasterDatesBlock: "easterDates",
  AdventCountdownBlock: "adventCountdown",
  CtaBlock: "cta",
  CardBlock: "card",
  PromoBannerBlock: "promoBanner",
  InfoBlocksBlock: "infoBlocks",
  ComponentSectionsVideoHero: "videoHero",
  ComponentSectionsSection: "sectionWrapper",
  ComponentSectionsVideo: "video",
  ComponentSectionsText: "text",
  ComponentSectionsRelatedQuestions: "relatedQuestions",
  ComponentSectionsBibleQuotesCarousel: "bibleQuotesCarousel",
  ComponentSectionsContainer: "container",
  ComponentSectionsMediaCollection: "mediaCollection",
  ComponentSectionsNavigationCarousel: "navigationCarousel",
  ComponentSectionsVideoCarousel: "videoCarousel",
  ComponentSectionsQuizButton: "quizButton",
  ComponentSectionsEasterDates: "easterDates",
  ComponentSectionsAdventCountdown: "adventCountdown",
  ComponentSectionsCta: "cta",
  ComponentSectionsCard: "card",
  ComponentSectionsPromoBanner: "promoBanner",
  ComponentSectionsInfoBlocks: "infoBlocks",
} as const satisfies Record<string, string>

export type SectionKind =
  (typeof TYPENAME_TO_KIND)[keyof typeof TYPENAME_TO_KIND]

// ── Wire shapes (derived from the query — the single source) ────────────────

export type RawWatchExperience = NonNullable<
  ResultOf<typeof GET_WATCH_EXPERIENCE>["experienceBySlug"]
>
type RawBlock = NonNullable<RawWatchExperience["blocks"]>[number]
type RawSection = Extract<RawBlock, { __typename: "SectionBlock" }>
type RawSectionContent = NonNullable<RawSection["sectionContent"]>[number]
type RawContainer = Extract<RawBlock, { __typename: "ContainerBlock" }>
type RawContainerContent = NonNullable<RawContainer["content"]>[number]

// The same typename can appear at any of the three nesting levels; union the
// selections so a model is valid wherever its block appears.
type AnyRawBlock = RawBlock | RawSectionContent | RawContainerContent
type RawOf<T extends AnyRawBlock["__typename"]> = Extract<
  AnyRawBlock,
  { __typename: T }
>

// ── Block models (the seam's output union) ──────────────────────────────────

export type VideoHeroBlockModel = RawOf<"VideoHeroBlock"> & {
  kind: "videoHero"
}
export type TextBlockModel = RawOf<"TextBlock"> & { kind: "text" }
export type VideoBlockModel = RawOf<"VideoBlock"> & { kind: "video" }
export type RelatedQuestionsBlockModel = RawOf<"RelatedQuestionsBlock"> & {
  kind: "relatedQuestions"
}
export type BibleQuotesCarouselBlockModel =
  RawOf<"BibleQuotesCarouselBlock"> & { kind: "bibleQuotesCarousel" }
export type MediaCollectionBlockModel = RawOf<"MediaCollectionBlock"> & {
  kind: "mediaCollection"
}
export type NavigationCarouselBlockModel = RawOf<"NavigationCarouselBlock"> & {
  kind: "navigationCarousel"
}
export type VideoCarouselBlockModel = RawOf<"VideoCarouselBlock"> & {
  kind: "videoCarousel"
}
export type QuizButtonBlockModel = RawOf<"QuizButtonBlock"> & {
  kind: "quizButton"
}
export type EasterDatesBlockModel = RawOf<"EasterDatesBlock"> & {
  kind: "easterDates"
}
// Fields ARE fetched (the query selects CTASectionFields/AdventCountdownFields);
// the dispatcher placeholders them today, but the model must not claim fieldless.
export type CtaBlockModel = RawOf<"CtaBlock"> & { kind: "cta" }
export type AdventCountdownBlockModel = RawOf<"AdventCountdownBlock"> & {
  kind: "adventCountdown"
}

export type SectionWrapperBlockModel = Omit<RawSection, "sectionContent"> & {
  kind: "sectionWrapper"
  sectionContent: NormalizedBlock[]
}

export type NormalizedSlot = {
  gridSpan?: number | null
  spans?: unknown
  slotContent: NormalizedBlock[]
}
export type ContainerBlockModel = Omit<RawContainer, "content"> & {
  kind: "container"
  slots: NormalizedSlot[]
}

// Kinds the query selects no fields for; the dispatcher placeholders them.
export type UnrenderedBlockModel = {
  kind: "card" | "promoBanner" | "infoBlocks"
  __typename: string
  sectionKey?: string | null
}

export type NormalizedBlock =
  | VideoHeroBlockModel
  | SectionWrapperBlockModel
  | ContainerBlockModel
  | VideoBlockModel
  | TextBlockModel
  | RelatedQuestionsBlockModel
  | BibleQuotesCarouselBlockModel
  | MediaCollectionBlockModel
  | NavigationCarouselBlockModel
  | VideoCarouselBlockModel
  | QuizButtonBlockModel
  | EasterDatesBlockModel
  | CtaBlockModel
  | AdventCountdownBlockModel
  | UnrenderedBlockModel

export type NormalizedExperience = {
  documentId: string
  slug: string
  title: string | null
  sections: NormalizedBlock[]
}

/** Scroll/layout key for a block: sectionKey where the fragment carries one. */
export function blockKey(block: NormalizedBlock): string | undefined {
  if ("sectionKey" in block && typeof block.sectionKey === "string") {
    return block.sectionKey
  }
  return undefined
}

// ── Implementation ───────────────────────────────────────────────────────────
// The interior stays generic (blocks arrive from three nesting levels and two
// schema generations); the one cast lives here, behind the typed interface.

function normalizeBlock(
  block: Record<string, unknown>,
): NormalizedBlock | null {
  const typename = block.__typename as string | undefined
  if (!typename) return null

  const kind = (TYPENAME_TO_KIND as Record<string, string>)[typename]
  if (!kind) {
    if (__DEV__) {
      console.warn(`[normalizer] Unknown block type: ${typename}`)
    }
    return null
  }

  // For sectionWrapper, recursively normalize nested content
  if (kind === "sectionWrapper" && Array.isArray(block.sectionContent)) {
    return {
      ...block,
      kind,
      sectionContent: normalizeContentArray(
        block.sectionContent as Record<string, unknown>[],
      ),
    } as unknown as NormalizedBlock
  }

  // Admin containers are flat: ContainerSlotBlock markers split content[] into
  // side-by-side slots (each marker carries the grid span). Reconstruct those
  // groups so ContainerRenderer lays them out by span instead of one column.
  if (kind === "container" && Array.isArray(block.content)) {
    return {
      ...block,
      kind,
      slots: groupContainerSlots(block.content as Record<string, unknown>[]),
    } as unknown as NormalizedBlock
  }

  if (kind === "container" && Array.isArray(block.slots)) {
    return {
      ...block,
      kind,
      slots: (block.slots as Record<string, unknown>[]).map((slot) => ({
        ...slot,
        slotContent: Array.isArray(slot.slotContent)
          ? normalizeContentArray(slot.slotContent as Record<string, unknown>[])
          : slot.slotContent,
      })),
    } as unknown as NormalizedBlock
  }

  return { ...block, kind } as unknown as NormalizedBlock
}

/**
 * Normalize an array of nested content blocks (used in Section and Container).
 */
function normalizeContentArray(
  items: Record<string, unknown>[],
): NormalizedBlock[] {
  return items
    .map((item) => normalizeBlock(item))
    .filter((item): item is NormalizedBlock => item !== null)
}

/**
 * Split a flat container `content[]` into side-by-side slot groups. Each
 * ContainerSlotBlock marker opens a slot carrying its span; following blocks
 * fill it. Content with no markers collapses into one slot (never vanishes).
 */
function groupContainerSlots(
  content: Record<string, unknown>[],
): NormalizedSlot[] {
  const slots: NormalizedSlot[] = []
  let current: NormalizedSlot | null = null

  for (const item of content) {
    if (item.__typename === "ContainerSlotBlock") {
      current = {
        gridSpan: item.gridSpan as number | null | undefined,
        spans: item.spans,
        slotContent: [],
      }
      slots.push(current)
      continue
    }
    const normalized = normalizeBlock(item)
    if (!normalized) continue
    if (!current) {
      current = { slotContent: [] }
      slots.push(current)
    }
    current.slotContent.push(normalized)
  }

  return slots.filter((slot) => slot.slotContent.length > 0)
}

/**
 * Normalize a full Experience response into typed sections.
 */
export function normalizeExperience(
  experience: RawWatchExperience,
): NormalizedExperience {
  const raw = experience as unknown as Record<string, unknown>
  const blocks = (raw.blocks ?? []) as Record<string, unknown>[]

  return {
    documentId: raw.documentId as string,
    slug: raw.slug as string,
    title: (raw.title as string) ?? null,
    sections: blocks
      .map((block) => normalizeBlock(block))
      .filter((block): block is NormalizedBlock => block !== null),
  }
}
