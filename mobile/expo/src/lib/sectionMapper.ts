/**
 * Maps raw GraphQL section responses to typed section models.
 *
 * Mirrors the iOS SectionMappers.swift pattern: leaf mappers for each section
 * type, structural mappers for Container/SectionWrapper with recursive content
 * resolution, and a top-level mapSections() entry point.
 */

import type { WatchExperienceSection } from "./graphql/queries"
import type {
  BibleQuoteItem,
  BibleQuotesCarouselSection,
  CardSection,
  ContainerSection,
  ContainerSlot,
  CTASection,
  CTAVariant,
  EasterDatesSection,
  ExperienceSection,
  MediaCollectionItem,
  MediaCollectionSection,
  MediaCollectionVariant,
  RelatedQuestionItem,
  RelatedQuestionsSection,
  SectionBackgroundColor,
  SectionContent,
  SectionWrapperSection,
  TextHeadingLevel,
  TextSection,
  TextVariant,
  CardVariant,
  UploadFileModel,
  VideoHeroSection,
  VideoModel,
  VideoSection,
} from "./sectionModels"

// -- Shared helpers --------------------------------------------------------

function mapUploadFile(file: {
  url: string
  alternativeText: string | null
}): UploadFileModel {
  return { url: file.url, alternativeText: file.alternativeText }
}

function mapUploadFileOrNull(
  file: { url: string; alternativeText: string | null } | null | undefined,
): UploadFileModel | null {
  return file ? mapUploadFile(file) : null
}

function mapVideoModel(video: {
  documentId: string
  slug: string
  title: string
  image: { url: string; alternativeText: string | null } | null
}): VideoModel {
  return {
    documentId: video.documentId,
    slug: video.slug,
    title: video.title,
    image: mapUploadFileOrNull(video.image),
  }
}

// -- Leaf mappers ----------------------------------------------------------

// Each mapper takes a raw GraphQL fragment result (accessed via the aliased
// fields from watchExperience.ts) and returns a typed section model.

// WatchExperienceBlock is Record<string, any> & { __typename: union, id } —
// not a true discriminated union, so TS can't narrow it through switch/case.
// Using `any` lets the leaf mappers' intersection types (e.g. RawSection &
// { __typename: "ComponentSectionsText" }) work without assignment errors.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawSection = any

function mapMediaCollection(
  raw: RawSection & { __typename: "ComponentSectionsMediaCollection" },
): MediaCollectionSection {
  const items: MediaCollectionItem[] = (raw.items ?? [])
    .filter((item): item is NonNullable<typeof item> => item != null)
    .map((item) => ({
      id: item.id,
      titleOverride: item.titleOverride ?? null,
      subtitleOverride: item.subtitleOverride ?? null,
      collectionSize: item.collectionSize ?? null,
      linkToSectionKey: item.linkToSectionKey ?? null,
      imageOverride: mapUploadFileOrNull(item.imageOverride),
      video: item.itemVideo ? mapVideoModel(item.itemVideo) : null,
    }))

  return {
    kind: "mediaCollection",
    id: raw.id,
    sectionKey: raw.sectionKey ?? null,
    title: raw.mediaCollectionTitle ?? null,
    subtitle: raw.subtitle ?? null,
    description: raw.mediaCollectionDescription ?? null,
    categoryLabel: raw.categoryLabel ?? null,
    ctaLink: raw.mediaCollectionCtaLink ?? null,
    showItemNumbers: raw.showItemNumbers ?? null,
    footerText: raw.footerText ?? null,
    variant:
      (raw.mediaCollectionVariant as MediaCollectionVariant) ?? "collection",
    items,
  }
}

function mapCta(
  raw: RawSection & { __typename: "ComponentSectionsCta" },
): CTASection {
  return {
    kind: "cta",
    id: raw.id,
    sectionKey: raw.sectionKey ?? null,
    heading: raw.ctaHeading ?? null,
    body: raw.body ?? null,
    buttonLabel: raw.buttonLabel,
    buttonLink: raw.buttonLink ?? null,
    variant: (raw.ctaVariant as CTAVariant) ?? null,
  }
}

function mapVideoHero(
  raw: RawSection & { __typename: "ComponentSectionsVideoHero" },
): VideoHeroSection {
  return {
    kind: "videoHero",
    id: raw.id,
    sectionKey: raw.sectionKey ?? null,
    heading: raw.videoHeroHeading ?? null,
    subheading: raw.subheading ?? null,
    ctaLink: raw.ctaLink ?? null,
    ctaLabel: raw.ctaLabel ?? null,
    streamingUrl: raw.streamingUrl ?? null,
    video: mapVideoModel(raw.heroVideo),
  }
}

function mapText(
  raw: RawSection & { __typename: "ComponentSectionsText" },
): TextSection {
  return {
    kind: "text",
    id: raw.id,
    sectionKey: raw.sectionKey ?? null,
    heading: raw.textHeading ?? null,
    headingLevel: (raw.headingLevel as TextHeadingLevel) ?? null,
    subtitle: raw.textSubtitle ?? null,
    content: raw.textContent,
    variant: (raw.textVariant as TextVariant) ?? null,
  }
}

function mapRelatedQuestions(
  raw: RawSection & { __typename: "ComponentSectionsRelatedQuestions" },
): RelatedQuestionsSection {
  const questions: RelatedQuestionItem[] = (raw.questions ?? [])
    .filter((q): q is NonNullable<typeof q> => q != null)
    .map((q) => ({
      id: q.id,
      question: q.question,
      answer: q.answer,
    }))

  return {
    kind: "relatedQuestions",
    id: raw.id,
    sectionKey: raw.sectionKey ?? null,
    heading: raw.relatedQuestionsHeading ?? null,
    questions,
  }
}

function mapBibleQuotesCarousel(
  raw: RawSection & { __typename: "ComponentSectionsBibleQuotesCarousel" },
): BibleQuotesCarouselSection {
  const quotes: BibleQuoteItem[] = (raw.quotes ?? [])
    .filter((q): q is NonNullable<typeof q> => q != null)
    .map((q) => ({
      id: q.id,
      reference: q.reference,
      text: q.text,
      backgroundImage: mapUploadFileOrNull(q.backgroundImage),
      ctaLabel: q.ctaLabel ?? null,
      ctaLink: q.ctaLink ?? null,
      attribution: q.attribution ?? null,
    }))

  return {
    kind: "bibleQuotesCarousel",
    id: raw.id,
    sectionKey: raw.sectionKey ?? null,
    heading: raw.carouselHeading ?? null,
    quotes,
  }
}

function mapCard(
  raw: RawSection & { __typename: "ComponentSectionsCard" },
): CardSection {
  return {
    kind: "card",
    id: raw.id,
    sectionKey: raw.sectionKey ?? null,
    title: raw.cardTitle,
    description: raw.cardDescription,
    media: mapUploadFileOrNull(raw.media),
    link: raw.link ?? null,
    variant: (raw.cardVariant as CardVariant) ?? null,
  }
}

function mapVideoSection(
  raw: RawSection & { __typename: "ComponentSectionsVideo" },
): VideoSection {
  return {
    kind: "video",
    id: raw.id,
    sectionKey: raw.sectionKey ?? null,
    streamingUrl: raw.streamingUrl,
    title: raw.videoTitle ?? null,
    subtitle: raw.videoSubtitle ?? null,
    media: mapUploadFileOrNull(raw.videoMedia),
    video: raw.sectionVideo ? mapVideoModel(raw.sectionVideo) : null,
  }
}

function mapEasterDates(
  raw: RawSection & { __typename: "ComponentSectionsEasterDates" },
): EasterDatesSection {
  return {
    kind: "easterDates",
    id: raw.id,
    sectionKey: raw.sectionKey ?? null,
    easterDatesTitle: raw.easterDatesTitle,
    westernEasterLabel: raw.westernEasterLabel,
    orthodoxEasterLabel: raw.orthodoxEasterLabel,
    passoverLabel: raw.passoverLabel,
    locale: raw.locale ?? null,
  }
}

// -- Content mapper (shared by Container slots and Section wrapper) ---------

/**
 * Maps a single content item from a dynamic zone to a SectionContent model.
 * Used for Container slot content and Section wrapper content.
 *
 * Uses `any` for the raw parameter because the nested content types from
 * Container.slots.content and Section.content have different generated types
 * at each nesting level, but the field shapes (via aliases) are identical.
 */
function mapContentItem(raw: any): SectionContent | null {
  if (!raw || !raw.__typename) return null

  switch (raw.__typename) {
    case "ComponentSectionsMediaCollection":
      return mapMediaCollection(raw)
    case "ComponentSectionsCta":
      return mapCta(raw)
    case "ComponentSectionsText":
      return mapText(raw)
    case "ComponentSectionsRelatedQuestions":
      return mapRelatedQuestions(raw)
    case "ComponentSectionsBibleQuotesCarousel":
      return mapBibleQuotesCarousel(raw)
    case "ComponentSectionsCard":
      return mapCard(raw)
    case "ComponentSectionsVideo":
      return mapVideoSection(raw)
    case "ComponentSectionsContainer":
      return mapContainer(raw)
    default:
      return null
  }
}

function mapContentArray(items: any[] | null | undefined): SectionContent[] {
  if (!items) return []
  return items
    .map((item) => mapContentItem(item))
    .filter((item): item is SectionContent => item != null)
}

// -- Structural mappers ----------------------------------------------------

function mapContainer(raw: any): ContainerSection {
  const slots: ContainerSlot[] = (raw.slots ?? [])
    .filter((slot: unknown): slot is NonNullable<typeof slot> => slot != null)
    .map((slot: any) => ({
      id: slot.id as string,
      gridSpan: slot.gridSpan as number,
      content: mapContentArray(slot.slotContent),
    }))

  return {
    kind: "container",
    id: raw.id,
    sectionKey: raw.sectionKey ?? null,
    slots,
  }
}

function mapSectionWrapper(raw: any): SectionWrapperSection {
  return {
    kind: "sectionWrapper",
    id: raw.id,
    sectionKey: raw.sectionKey ?? null,
    backgroundColor: (raw.backgroundColor as SectionBackgroundColor) ?? null,
    blurHash: raw.blurHash ?? null,
    content: mapContentArray(raw.sectionContent),
  }
}

// -- Top-level entry point -------------------------------------------------

/**
 * Maps an array of raw GraphQL sections to typed ExperienceSection models.
 */
export function mapSections(
  rawSections: (WatchExperienceSection | null)[] | null | undefined,
): ExperienceSection[] {
  if (!rawSections) return []

  return rawSections
    .filter((s): s is WatchExperienceSection => s != null)
    .map((raw): ExperienceSection | null => {
      switch (raw.__typename) {
        case "ComponentSectionsMediaCollection":
          return mapMediaCollection(raw)
        case "ComponentSectionsCta":
          return mapCta(raw)
        case "ComponentSectionsVideoHero":
          return mapVideoHero(raw)
        case "ComponentSectionsText":
          return mapText(raw)
        case "ComponentSectionsRelatedQuestions":
          return mapRelatedQuestions(raw)
        case "ComponentSectionsBibleQuotesCarousel":
          return mapBibleQuotesCarousel(raw)
        case "ComponentSectionsCard":
          return mapCard(raw)
        case "ComponentSectionsVideo":
          return mapVideoSection(raw)
        case "ComponentSectionsContainer":
          return mapContainer(raw)
        case "ComponentSectionsSection":
          return mapSectionWrapper(raw)
        case "ComponentSectionsEasterDates":
          return mapEasterDates(raw)
        default:
          // PromoBanner, InfoBlocks, Error — skip
          return null
      }
    })
    .filter((s): s is ExperienceSection => s != null)
}

/**
 * Scans top-level sections for the first non-empty heading/title.
 * Useful as a fallback experience title.
 */
export function firstSectionTitle(
  sections: ExperienceSection[],
): string | null {
  for (const section of sections) {
    switch (section.kind) {
      case "videoHero":
        if (section.heading) return section.heading
        break
      case "mediaCollection":
        if (section.title) return section.title
        break
      case "text":
        if (section.heading) return section.heading
        break
      case "card":
        if (section.title) return section.title
        break
      case "cta":
        if (section.heading) return section.heading
        break
      case "relatedQuestions":
        if (section.heading) return section.heading
        break
      case "bibleQuotesCarousel":
        if (section.heading) return section.heading
        break
      case "video":
        if (section.title) return section.title
        break
      case "easterDates":
        if (section.easterDatesTitle) {
          return section.easterDatesTitle.replace(
            "{year}",
            String(new Date().getFullYear()),
          )
        }
        break
    }
  }
  return null
}
