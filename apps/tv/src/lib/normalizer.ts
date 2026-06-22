// SYNC: keep in sync with apps/mobile/src/lib/normalizer.ts

/**
 * Thin normalizer: maps __typename strings to clean `kind` discriminants. No
 * parallel type hierarchy — renderers receive gql.tada ResultOf types with
 * `kind` added for dispatch.
 */

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

export type NormalizedBlock = {
  kind: SectionKind
  __typename: string
  [key: string]: unknown
}

export type NormalizedExperience = {
  documentId: string
  slug: string
  title: string | null
  sections: NormalizedBlock[]
}

/**
 * Normalize a single block by adding `kind` from its __typename.
 * Returns null for unknown types (logged in dev).
 */
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

  // For container, recursively normalize admin content or legacy slot content.
  if (kind === "container" && Array.isArray(block.content)) {
    return {
      ...block,
      kind,
      slots: [
        {
          slotContent: normalizeContentArray(
            block.content as Record<string, unknown>[],
          ),
        },
      ],
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

  return { ...block, kind } as NormalizedBlock
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
 * Normalize a full Experience response into typed sections.
 */
export function normalizeExperience(
  experience: Record<string, unknown>,
): NormalizedExperience {
  const blocks = (experience.blocks ?? []) as Record<string, unknown>[]

  return {
    documentId: experience.documentId as string,
    slug: experience.slug as string,
    title: (experience.title as string) ?? null,
    sections: blocks
      .map((block) => normalizeBlock(block))
      .filter((block): block is NormalizedBlock => block !== null),
  }
}
