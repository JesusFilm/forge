import { z } from "zod"

const DraftSectionRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^s\d{2}$/)

const DraftVideoRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^v\d{2}$/)

const DraftHeadingLevelSchema = z.enum(["h1", "h2", "h3", "h4", "h5", "h6"])

export const DraftBibleQuoteItemSchema = z
  .object({
    reference: z.string().min(1),
    text: z.string().min(1),
    attribution: z.string().optional(),
    ctaEnabled: z.boolean().optional(),
    ctaLabel: z.string().optional(),
    ctaLink: z.string().optional(),
    backgroundColor: z.string().optional(),
  })
  .strict()

export const DraftInfoBlockItemSchema = z
  .object({
    icon: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
  })
  .strict()

export const DraftMediaCollectionItemSchema = z
  .object({
    candidateRef: DraftVideoRefSchema,
    titleOverride: z.string().optional(),
    subtitleOverride: z.string().optional(),
    labelOverride: z.string().optional(),
    collectionSize: z.string().optional(),
    targetRef: DraftSectionRefSchema.optional(),
  })
  .strict()

export const DraftNavigationCarouselItemSchema = z
  .object({
    targetRef: DraftSectionRefSchema,
    title: z.string().min(1),
    category: z.string().optional(),
    backgroundColor: z.string().optional(),
  })
  .strict()

export const DraftRelatedQuestionItemSchema = z
  .object({
    question: z.string().min(1),
    answer: z.string().min(1),
  })
  .strict()

export const DraftVideoCarouselItemSchema = z
  .object({
    candidateRef: DraftVideoRefSchema,
    titleOverride: z.string().optional(),
    subtitleOverride: z.string().optional(),
    backgroundColor: z.string().optional(),
  })
  .strict()

export const DraftAdventCountdownBlockSchema = z
  .object({
    t: z.literal("adventCountdown"),
    sectionRef: DraftSectionRefSchema.optional(),
    backgroundColor: z.string().optional(),
    title: z.string().min(1),
    scripture: z.string().optional(),
    scriptureReference: z.string().optional(),
    locale: z.string().optional(),
  })
  .strict()

export const DraftBibleQuotesCarouselBlockSchema = z
  .object({
    t: z.literal("bibleQuotesCarousel"),
    sectionRef: DraftSectionRefSchema.optional(),
    backgroundColor: z.string().optional(),
    heading: z.string().optional(),
    quotes: z.array(DraftBibleQuoteItemSchema).default([]),
  })
  .strict()

export const DraftCardBlockSchema = z
  .object({
    t: z.literal("card"),
    sectionRef: DraftSectionRefSchema.optional(),
    title: z.string().min(1),
    description: z.string().min(1),
    backgroundColor: z.string().optional(),
    link: z.string().optional(),
    variant: z.enum(["default", "featured"]).optional(),
  })
  .strict()

export const DraftCtaBlockSchema = z
  .object({
    t: z.literal("cta"),
    sectionRef: DraftSectionRefSchema.optional(),
    backgroundColor: z.string().optional(),
    heading: z.string().optional(),
    body: z.string().optional(),
    buttonLabel: z.string().min(1),
    buttonLink: z.string().optional(),
    variant: z.enum(["primary", "secondary"]).optional(),
  })
  .strict()

export const DraftEasterDatesBlockSchema = z
  .object({
    t: z.literal("easterDates"),
    sectionRef: DraftSectionRefSchema.optional(),
    backgroundColor: z.string().optional(),
    easterDatesTitle: z.string().min(1),
    westernEasterLabel: z.string().min(1),
    orthodoxEasterLabel: z.string().min(1),
    passoverLabel: z.string().min(1),
    westernEasterEnabled: z.boolean().optional(),
    orthodoxEasterEnabled: z.boolean().optional(),
    passoverEnabled: z.boolean().optional(),
    locale: z.string().optional(),
  })
  .strict()

export const DraftInfoBlocksBlockSchema = z
  .object({
    t: z.literal("infoBlocks"),
    sectionRef: DraftSectionRefSchema.optional(),
    backgroundColor: z.string().optional(),
    widthPercent: z.number().int().min(1).max(100).optional(),
    intro: z.string().optional(),
    heading: z.string().optional(),
    description: z.string().optional(),
    blocks: z.array(DraftInfoBlockItemSchema).default([]),
  })
  .strict()

export const DraftMediaCollectionBlockSchema = z
  .object({
    t: z.literal("mediaCollection"),
    sectionRef: DraftSectionRefSchema.optional(),
    backgroundColor: z.string().optional(),
    categoryLabel: z.string().optional(),
    variant: z
      .enum(["carousel", "grid", "collection", "hero", "player"])
      .default("collection"),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    description: z.string().optional(),
    ctaLink: z.string().optional(),
    ctaLabel: z.string().optional(),
    showItemNumbers: z.boolean().optional(),
    footerText: z.string().optional(),
    items: z.array(DraftMediaCollectionItemSchema).default([]),
  })
  .strict()

export const DraftNavigationCarouselBlockSchema = z
  .object({
    t: z.literal("navigationCarousel"),
    sectionRef: DraftSectionRefSchema.optional(),
    backgroundColor: z.string().optional(),
    items: z.array(DraftNavigationCarouselItemSchema).default([]),
  })
  .strict()

export const DraftPromoBannerBlockSchema = z
  .object({
    t: z.literal("promoBanner"),
    sectionRef: DraftSectionRefSchema.optional(),
    backgroundColor: z.string().optional(),
    widthPercent: z.number().int().min(1).max(100).optional(),
    intro: z.string().optional(),
    heading: z.string().min(1),
    description: z.string().min(1),
    ctaEnabled: z.boolean().optional(),
    ctaLabel: z.string().optional(),
    ctaLink: z.string().min(1),
  })
  .strict()

export const DraftQuizButtonBlockSchema = z
  .object({
    t: z.literal("quizButton"),
    buttonText: z.string().min(1),
    iframeSrc: z.string().regex(/^https:\/\/[\w.-]+\.nextstep\.is\/.*$/),
  })
  .strict()

export const DraftRelatedQuestionsBlockSchema = z
  .object({
    t: z.literal("relatedQuestions"),
    sectionRef: DraftSectionRefSchema.optional(),
    backgroundColor: z.string().optional(),
    heading: z.string().optional(),
    questions: z.array(DraftRelatedQuestionItemSchema).default([]),
    ctaEnabled: z.boolean().optional(),
    ctaLabel: z.string().optional(),
    ctaLink: z.string().optional(),
  })
  .strict()

export const DraftTextBlockSchema = z
  .object({
    t: z.literal("text"),
    sectionRef: DraftSectionRefSchema.optional(),
    backgroundColor: z.string().optional(),
    heading: z.string().optional(),
    headingLevel: DraftHeadingLevelSchema.optional(),
    subtitle: z.string().optional(),
    contentParagraphs: z.array(z.string()).optional(),
    variant: z.enum(["default", "lead", "small"]).optional(),
  })
  .strict()

export const DraftVideoBlockSchema = z
  .object({
    t: z.literal("video"),
    sectionRef: DraftSectionRefSchema.optional(),
    candidateRef: DraftVideoRefSchema,
    clipStartSeconds: z.number().min(0).optional(),
    clipEndSeconds: z.number().min(0).optional(),
    autoplay: z.boolean().optional(),
    muted: z.boolean().optional(),
    loop: z.boolean().optional(),
    showControls: z.boolean().optional(),
    titleSource: z.enum(["manual", "videoTitle"]).optional(),
    subtitleSource: z.enum(["manual", "videoDescription"]).optional(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
  })
  .strict()

export const DraftVideoCarouselBlockSchema = z
  .object({
    t: z.literal("videoCarousel"),
    sectionRef: DraftSectionRefSchema.optional(),
    backgroundColor: z.string().optional(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    description: z.string().optional(),
    items: z.array(DraftVideoCarouselItemSchema).default([]),
  })
  .strict()

export const DraftVideoHeroBlockSchema = z
  .object({
    t: z.literal("videoHero"),
    sectionRef: DraftSectionRefSchema.optional(),
    candidateRef: DraftVideoRefSchema,
    ctaEnabled: z.boolean().optional(),
    clipStartSeconds: z.number().min(0).optional(),
    clipEndSeconds: z.number().min(0).optional(),
    autoplay: z.boolean().optional(),
    muted: z.boolean().optional(),
    loop: z.boolean().optional(),
    showControls: z.boolean().optional(),
    headingSource: z.enum(["manual", "videoTitle"]).optional(),
    subheadingSource: z.enum(["manual", "videoDescription"]).optional(),
    heading: z.string().optional(),
    subheading: z.string().optional(),
    ctaLink: z.string().optional(),
    ctaLabel: z.string().optional(),
  })
  .strict()

export const DraftContainerSlotSpansSchema = z
  .object({
    xs: z.number().int().min(1).max(12).optional(),
    sm: z.number().int().min(1).max(12).optional(),
    md: z.number().int().min(1).max(12).optional(),
    lg: z.number().int().min(1).max(12).optional(),
    xl: z.number().int().min(1).max(12).optional(),
  })
  .strict()

export const DraftContainerSlotSchema = z.lazy(() =>
  z
    .object({
      gridSpan: z.number().int().min(1).max(12).optional(),
      spans: DraftContainerSlotSpansSchema.optional(),
      backgroundColor: z.string().optional(),
      content: z.array(DraftContainerContentBlockSchema).default([]),
    })
    .strict(),
)

export const DraftContainerBlockSchema = z
  .object({
    t: z.literal("container"),
    sectionRef: DraftSectionRefSchema.optional(),
    backgroundColor: z.string().optional(),
    slots: z.array(DraftContainerSlotSchema).default([]),
  })
  .strict()

export const DraftSectionBlockSchema = z
  .object({
    t: z.literal("section"),
    sectionRef: DraftSectionRefSchema.optional(),
    backgroundColor: z.string().optional(),
    backgroundOpacity: z.number().min(0).max(1).optional(),
    dynamicBackgroundImage: z.boolean().optional(),
    staticOverlay: z.boolean().optional(),
    content: z.array(z.lazy(() => DraftSectionContentBlockSchema)).default([]),
  })
  .strict()

export const DraftContainerContentBlockSchema = z.discriminatedUnion("t", [
  DraftMediaCollectionBlockSchema,
  DraftTextBlockSchema,
  DraftRelatedQuestionsBlockSchema,
  DraftCtaBlockSchema,
  DraftBibleQuotesCarouselBlockSchema,
  DraftCardBlockSchema,
  DraftEasterDatesBlockSchema,
  DraftAdventCountdownBlockSchema,
  DraftVideoBlockSchema,
])

export const DraftSectionContentBlockSchema = z.discriminatedUnion("t", [
  DraftMediaCollectionBlockSchema,
  DraftTextBlockSchema,
  DraftPromoBannerBlockSchema,
  DraftInfoBlocksBlockSchema,
  DraftCtaBlockSchema,
  DraftContainerBlockSchema,
  DraftRelatedQuestionsBlockSchema,
  DraftBibleQuotesCarouselBlockSchema,
  DraftCardBlockSchema,
  DraftVideoBlockSchema,
  DraftQuizButtonBlockSchema,
  DraftVideoCarouselBlockSchema,
  DraftNavigationCarouselBlockSchema,
])

export const DraftBlockSchema = z.discriminatedUnion("t", [
  DraftMediaCollectionBlockSchema,
  DraftPromoBannerBlockSchema,
  DraftInfoBlocksBlockSchema,
  DraftCtaBlockSchema,
  DraftVideoHeroBlockSchema,
  DraftContainerBlockSchema,
  DraftTextBlockSchema,
  DraftSectionBlockSchema,
  DraftRelatedQuestionsBlockSchema,
  DraftBibleQuotesCarouselBlockSchema,
  DraftCardBlockSchema,
  DraftEasterDatesBlockSchema,
  DraftAdventCountdownBlockSchema,
  DraftVideoBlockSchema,
  DraftVideoCarouselBlockSchema,
  DraftNavigationCarouselBlockSchema,
])

export const DraftExperienceSchema = z
  .object({
    title: z.string().min(1),
    metaDescription: z.string().min(1),
    blocks: z.array(z.lazy(() => DraftBlockSchema)).min(2),
  })
  .strict()

export type DraftExperience = z.infer<typeof DraftExperienceSchema>
export type DraftBlock = z.infer<typeof DraftBlockSchema>
export type DraftTopLevelBlock = DraftBlock
export type DraftSectionBlock = z.infer<typeof DraftSectionBlockSchema>
export type DraftContainerBlock = z.infer<typeof DraftContainerBlockSchema>
export type DraftSectionContentBlock = z.infer<
  typeof DraftSectionContentBlockSchema
>
export type DraftContainerContentBlock = z.infer<
  typeof DraftContainerContentBlockSchema
>
export type DraftAnyBlock =
  | DraftBlock
  | DraftSectionContentBlock
  | DraftContainerContentBlock

export type VideoCandidate = {
  ref: z.infer<typeof DraftVideoRefSchema>
  videoId: string
  slug: string
  title: string
  description: string | null
  previewImageUrl: string | null
  previewStreamUrl: string | null
  label: string | null
}

export function buildDraftExperienceJsonSchema() {
  if (typeof z.toJSONSchema === "function") {
    return z.toJSONSchema(DraftExperienceSchema)
  }

  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "metaDescription", "blocks"],
    properties: {
      title: { type: "string", minLength: 1 },
      metaDescription: { type: "string", minLength: 1 },
      blocks: { type: "array", minItems: 2 },
    },
  }
}
