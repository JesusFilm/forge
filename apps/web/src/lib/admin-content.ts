import { z } from "zod"
import { env } from "@/env"
import type { WatchExperience } from "@/lib/content"

const HeadingLevelSchema = z.enum(["h1", "h2", "h3", "h4", "h5", "h6"])

const AdminInfoBlockItemSchema = z.object({
  icon: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
})

const AdminMediaCollectionItemSchema = z.object({
  videoId: z.string().optional(),
  imageOverrideUrl: z.string().optional(),
  titleOverride: z.string().optional(),
  subtitleOverride: z.string().optional(),
  labelOverride: z.string().optional(),
  collectionSize: z.string().optional(),
  imageUrl: z.string().optional(),
  linkToSectionKey: z.string().optional(),
})

const AdminVideoCarouselItemSchema = z.object({
  videoId: z.string().optional(),
  streamingUrl: z.string().optional(),
  imageUrl: z.string().optional(),
  imageOverrideUrl: z.string().optional(),
  titleOverride: z.string().optional(),
  subtitleOverride: z.string().optional(),
  backgroundColor: z.string().optional(),
})

const AdminNavigationCarouselItemSchema = z.object({
  contentId: z.string(),
  title: z.string(),
  category: z.string().optional(),
  imageUrl: z.string().optional(),
  backgroundColor: z.string().optional(),
})

const AdminRelatedQuestionItemSchema = z.object({
  question: z.string(),
  answer: z.string(),
})

const AdminBibleQuoteItemSchema = z.object({
  reference: z.string(),
  text: z.string(),
  attribution: z.string().optional(),
  imageUrl: z.string().optional(),
  backgroundColor: z.string().optional(),
  ctaLabel: z.string().optional(),
  ctaLink: z.string().optional(),
})

const AdminTextBlockSchema = z.object({
  t: z.literal("text"),
  sectionKey: z.string().optional(),
  heading: z.string().optional(),
  headingLevel: HeadingLevelSchema.optional(),
  subtitle: z.string().optional(),
  contentParagraphs: z.array(z.string()).optional(),
  variant: z.enum(["default", "lead", "small"]).optional(),
})

const AdminVideoHeroBlockSchema = z.object({
  t: z.literal("videoHero"),
  sectionKey: z.string().optional(),
  useRouteVideo: z.boolean().optional(),
  videoId: z.string().optional(),
  heading: z.string().optional(),
  subheading: z.string().optional(),
  ctaLabel: z.string().optional(),
  ctaLink: z.string().optional(),
  streamingUrl: z.string().optional(),
})

const AdminVideoBlockSchema = z.object({
  t: z.literal("video"),
  sectionKey: z.string().optional(),
  useRouteVideo: z.boolean().optional(),
  videoId: z.string().optional(),
  streamingUrl: z.string().optional(),
  mediaUrl: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
})

const AdminMediaCollectionBlockSchema = z.object({
  t: z.literal("mediaCollection"),
  sectionKey: z.string().optional(),
  categoryLabel: z.string().optional(),
  variant: z.enum(["carousel", "grid", "collection", "hero", "player"]),
  itemsSource: z.enum(["manual", "routeVideoChildren"]).optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  ctaLink: z.string().optional(),
  ctaLabel: z.string().optional(),
  showItemNumbers: z.boolean().optional(),
  footerText: z.string().optional(),
  items: z.array(AdminMediaCollectionItemSchema).optional(),
})

const AdminVideoCarouselBlockSchema = z.object({
  t: z.literal("videoCarousel"),
  sectionKey: z.string().optional(),
  itemsSource: z.enum(["manual", "routeVideoChildren"]).optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  items: z.array(AdminVideoCarouselItemSchema).optional(),
})

const AdminInfoBlocksBlockSchema = z.object({
  t: z.literal("infoBlocks"),
  sectionKey: z.string().optional(),
  heading: z.string().optional(),
  intro: z.string().optional(),
  description: z.string().optional(),
  blocks: z.array(AdminInfoBlockItemSchema).optional(),
})

const AdminCtaBlockSchema = z.object({
  t: z.literal("cta"),
  sectionKey: z.string().optional(),
  heading: z.string().optional(),
  body: z.string().optional(),
  buttonLabel: z.string().optional(),
  buttonLink: z.string().optional(),
})

const AdminPromoBannerBlockSchema = z.object({
  t: z.literal("promoBanner"),
  sectionKey: z.string().optional(),
  intro: z.string().optional(),
  heading: z.string(),
  description: z.string(),
  ctaLink: z.string().optional(),
})

const AdminRelatedQuestionsBlockSchema = z.object({
  t: z.literal("relatedQuestions"),
  sectionKey: z.string().optional(),
  heading: z.string().optional(),
  ctaLabel: z.string().optional(),
  ctaLink: z.string().optional(),
  questions: z.array(AdminRelatedQuestionItemSchema).optional(),
})

const AdminNavigationCarouselBlockSchema = z.object({
  t: z.literal("navigationCarousel"),
  sectionKey: z.string().optional(),
  items: z.array(AdminNavigationCarouselItemSchema).optional(),
})

const AdminBibleQuotesCarouselBlockSchema = z.object({
  t: z.literal("bibleQuotesCarousel"),
  sectionKey: z.string().optional(),
  heading: z.string().optional(),
  quotes: z.array(AdminBibleQuoteItemSchema).optional(),
})

const AdminQuizButtonBlockSchema = z.object({
  t: z.literal("quizButton"),
  buttonText: z.string(),
  iframeSrc: z.string(),
})

type NormalizedAdminBlock = Record<string, unknown> & {
  __typename: string
  id: string
}

type AdminBlock = z.infer<typeof AdminBlockSchema>
type AdminSectionContentBlock = z.infer<typeof AdminSectionContentBlockSchema>
type AdminContainerContentBlock = z.infer<
  typeof AdminContainerContentBlockSchema
>

const AdminContainerSlotBlockSchema = z.object({
  t: z.literal("containerSlot"),
  gridSpan: z.number().optional(),
  spans: z.record(z.string(), z.number()).optional(),
})

const AdminContainerContentBlockSchema = z.discriminatedUnion("t", [
  AdminContainerSlotBlockSchema,
  AdminTextBlockSchema,
  AdminMediaCollectionBlockSchema,
  AdminRelatedQuestionsBlockSchema,
  AdminCtaBlockSchema,
  AdminBibleQuotesCarouselBlockSchema,
  AdminVideoBlockSchema,
  AdminInfoBlocksBlockSchema,
])

const AdminContainerBlockSchema = z.object({
  t: z.literal("container"),
  sectionKey: z.string().optional(),
  content: z.array(AdminContainerContentBlockSchema).optional(),
})

const AdminSectionContentBlockSchema = z.discriminatedUnion("t", [
  AdminTextBlockSchema,
  AdminMediaCollectionBlockSchema,
  AdminPromoBannerBlockSchema,
  AdminInfoBlocksBlockSchema,
  AdminCtaBlockSchema,
  AdminContainerBlockSchema,
  AdminRelatedQuestionsBlockSchema,
  AdminBibleQuotesCarouselBlockSchema,
  AdminVideoBlockSchema,
  AdminQuizButtonBlockSchema,
  AdminVideoCarouselBlockSchema,
  AdminNavigationCarouselBlockSchema,
])

const AdminSectionBlockSchema = z.object({
  t: z.literal("section"),
  sectionKey: z.string().optional(),
  backgroundColor: z.string().optional(),
  backgroundImageUrl: z.string().optional(),
  blurHash: z.string().optional(),
  backgroundOpacity: z.number().optional(),
  dynamicBackgroundImage: z.boolean().optional(),
  staticOverlay: z.boolean().optional(),
  content: z.array(AdminSectionContentBlockSchema).optional(),
})

const AdminBlockSchema = z.discriminatedUnion("t", [
  AdminTextBlockSchema,
  AdminVideoHeroBlockSchema,
  AdminVideoBlockSchema,
  AdminMediaCollectionBlockSchema,
  AdminVideoCarouselBlockSchema,
  AdminInfoBlocksBlockSchema,
  AdminCtaBlockSchema,
  AdminPromoBannerBlockSchema,
  AdminRelatedQuestionsBlockSchema,
  AdminNavigationCarouselBlockSchema,
  AdminBibleQuotesCarouselBlockSchema,
  AdminContainerBlockSchema,
  AdminSectionBlockSchema,
])

const AdminExperienceSchema = z.object({
  id: z.string(),
  locale: z.string(),
  slug: z.string(),
  title: z.string().nullable().optional(),
  metaDescription: z.string().nullable().optional(),
  ogTitle: z.string().nullable().optional(),
  ogDescription: z.string().nullable().optional(),
  ogImageUrl: z.string().nullable().optional(),
  blocks: z.array(z.unknown()).default([]),
  referencedVideos: z
    .array(
      z.object({
        id: z.string(),
        slug: z.string().nullable().optional(),
        label: z.string().nullable().optional(),
        locales: z
          .array(
            z.object({
              locale: z.string(),
              title: z.string().nullable().optional(),
              description: z.string().nullable().optional(),
              snippet: z.string().nullable().optional(),
            }),
          )
          .nullable()
          .optional(),
        images: z
          .array(z.object({ url: z.string().nullable().optional() }).nullable())
          .nullable()
          .optional(),
        dubs: z
          .array(
            z
              .object({
                hls: z.string().nullable().optional(),
                published: z.boolean().nullable().optional(),
                language: z
                  .object({
                    bcp47: z.string().nullable().optional(),
                    iso3: z.string().nullable().optional(),
                    slug: z.string().nullable().optional(),
                  })
                  .nullable()
                  .optional(),
              })
              .nullable(),
          )
          .nullable()
          .optional(),
      }),
    )
    .nullable()
    .optional(),
})

type AdminExperience = z.infer<typeof AdminExperienceSchema>
type AdminReferencedVideo = NonNullable<
  NonNullable<AdminExperience["referencedVideos"]>[number]
>
type VideoMap = Map<string, AdminReferencedVideo>

function blockId(sectionKey: string | undefined, fallback: string) {
  return sectionKey ? `admin-${sectionKey}` : fallback
}

function videoTitle(video: AdminReferencedVideo | undefined, locale: string) {
  return (
    video?.locales?.find((entry) => entry?.locale === locale)?.title ?? null
  )
}

function videoDescription(
  video: AdminReferencedVideo | undefined,
  locale: string,
) {
  const videoLocale = video?.locales?.find((entry) => entry?.locale === locale)
  return videoLocale?.description ?? videoLocale?.snippet ?? null
}

function videoImage(video: AdminReferencedVideo | undefined) {
  return video?.images?.find((image) => image?.url)?.url ?? null
}

function dubMatchesLocale(
  dub: NonNullable<AdminReferencedVideo["dubs"]>[number],
  locale: string,
) {
  return (
    dub?.language?.bcp47 === locale ||
    dub?.language?.iso3 === locale ||
    dub?.language?.slug === locale
  )
}

function videoStream(video: AdminReferencedVideo | undefined, locale: string) {
  return (
    video?.dubs?.find(
      (dub) =>
        dub?.published === true && dub.hls && dubMatchesLocale(dub, locale),
    )?.hls ??
    video?.dubs?.find((dub) => dub?.hls && dubMatchesLocale(dub, locale))
      ?.hls ??
    null
  )
}

function mediaItem(
  item: z.infer<typeof AdminMediaCollectionItemSchema>,
  id: string,
  videos: VideoMap,
  locale: string,
) {
  const video = item.videoId ? videos.get(item.videoId) : undefined
  return {
    id,
    titleOverride: item.titleOverride ?? videoTitle(video, locale),
    subtitleOverride: item.subtitleOverride ?? videoDescription(video, locale),
    labelOverride: item.labelOverride ?? null,
    collectionSize: item.collectionSize ?? null,
    imageUrl: item.imageUrl ?? item.imageOverrideUrl ?? videoImage(video),
    imageOverride: item.imageOverrideUrl
      ? { url: item.imageOverrideUrl }
      : null,
    video: video
      ? {
          documentId: video.id,
          title: videoTitle(video, locale),
          slug: video.slug ?? null,
          images: (video.images ?? []).filter(Boolean),
        }
      : null,
  }
}

function videoCarouselItem(
  item: z.infer<typeof AdminVideoCarouselItemSchema>,
  id: string,
  videos: VideoMap,
  locale: string,
) {
  const video = item.videoId ? videos.get(item.videoId) : undefined
  return {
    id,
    streamingUrl: item.streamingUrl ?? videoStream(video, locale),
    imageUrl: item.imageUrl ?? item.imageOverrideUrl ?? videoImage(video),
    titleOverride: item.titleOverride ?? videoTitle(video, locale),
    backgroundColor: item.backgroundColor ?? null,
    video: video
      ? {
          documentId: video.id,
          title: videoTitle(video, locale),
          slug: video.slug ?? null,
          images: (video.images ?? []).filter(Boolean),
        }
      : null,
  }
}

function normalizeContainerContent(
  blocks: AdminContainerContentBlock[] | undefined,
  parentId: string,
  videos: VideoMap,
  locale: string,
) {
  const slots: Array<Record<string, unknown>> = []
  let currentSlot: Record<string, unknown> | null = null

  for (const [index, block] of (blocks ?? []).entries()) {
    if (block.t === "containerSlot") {
      currentSlot = {
        id: `${parentId}-slot-${slots.length}`,
        gridSpan: block.gridSpan ?? 6,
        spans: block.spans ?? null,
        content: [],
      }
      slots.push(currentSlot)
      continue
    }

    if (!currentSlot) {
      currentSlot = {
        id: `${parentId}-slot-0`,
        gridSpan: 12,
        spans: null,
        content: [],
      }
      slots.push(currentSlot)
    }

    const normalized = normalizeAdminBlock(
      block,
      `${parentId}-slot-${index}`,
      videos,
      locale,
    )
    if (normalized) {
      ;(currentSlot.content as NormalizedAdminBlock[]).push(normalized)
    }
  }

  return slots
}

function normalizeSectionContent(
  blocks: AdminSectionContentBlock[] | undefined,
  parentId: string,
  videos: VideoMap,
  locale: string,
) {
  return (blocks ?? [])
    .map((block, index) =>
      normalizeAdminBlock(block, `${parentId}-${index}`, videos, locale),
    )
    .filter((block): block is NormalizedAdminBlock => block != null)
}

function normalizeAdminBlock(
  block: AdminBlock | AdminSectionContentBlock | AdminContainerContentBlock,
  fallbackId: string,
  videos: VideoMap,
  locale: string,
): NormalizedAdminBlock | null {
  switch (block.t) {
    case "text":
      return {
        __typename: "ComponentSectionsText",
        id: blockId(block.sectionKey, fallbackId),
        sectionKey: block.sectionKey ?? null,
        heading: block.heading ?? null,
        headingLevel: block.headingLevel ?? null,
        subtitle: block.subtitle ?? null,
        contentParagraphs: block.contentParagraphs ?? [],
        textVariant: block.variant ?? null,
      }
    case "videoHero": {
      const heroVideo =
        "videoId" in block && typeof block.videoId === "string"
          ? videos.get(block.videoId)
          : undefined
      return {
        __typename: "ComponentSectionsVideoHero",
        id: blockId(block.sectionKey, fallbackId),
        sectionKey: block.sectionKey ?? null,
        useRouteVideo: block.useRouteVideo ?? false,
        heading: block.heading ?? null,
        subheading: block.subheading ?? null,
        ctaLabel: block.ctaLabel ?? null,
        ctaLink: block.ctaLink ?? null,
        streamingUrl: block.streamingUrl ?? videoStream(heroVideo, locale),
        video: heroVideo
          ? {
              documentId: heroVideo.id,
              title: videoTitle(heroVideo, locale),
              slug: heroVideo.slug ?? null,
              images: (heroVideo.images ?? []).filter(Boolean),
            }
          : null,
      }
    }
    case "video": {
      const video =
        "videoId" in block && typeof block.videoId === "string"
          ? videos.get(block.videoId)
          : undefined
      return {
        __typename: "ComponentSectionsVideo",
        id: blockId(block.sectionKey, fallbackId),
        sectionKey: block.sectionKey ?? null,
        useRouteVideo: block.useRouteVideo ?? false,
        streamingUrl: block.streamingUrl ?? videoStream(video, locale),
        title: block.title ?? videoTitle(video, locale),
        subtitle: block.subtitle ?? videoDescription(video, locale),
        media:
          block.mediaUrl || videoImage(video)
            ? { url: block.mediaUrl ?? videoImage(video) }
            : null,
        videoRef: video
          ? {
              documentId: video.id,
              title: videoTitle(video, locale),
              slug: video.slug ?? null,
              images: (video.images ?? []).filter(Boolean),
            }
          : null,
      }
    }
    case "mediaCollection":
      return {
        __typename: "ComponentSectionsMediaCollection",
        id: blockId(block.sectionKey, fallbackId),
        title: block.title ?? null,
        subtitle: block.subtitle ?? null,
        mediaDescription: block.description ?? null,
        categoryLabel: block.categoryLabel ?? null,
        itemsSource: block.itemsSource ?? "manual",
        mediaCtaLink: block.ctaLink ?? null,
        mediaCtaLabel: block.ctaLabel ?? null,
        showItemNumbers: block.showItemNumbers ?? false,
        mediaCollectionVariant: block.variant,
        footerText: block.footerText ?? null,
        items: (block.items ?? []).map((item, index) =>
          mediaItem(item, `${fallbackId}-item-${index}`, videos, locale),
        ),
      }
    case "videoCarousel":
      return {
        __typename: "ComponentSectionsVideoCarousel",
        id: blockId(block.sectionKey, fallbackId),
        sectionKey: block.sectionKey ?? null,
        title: block.title ?? null,
        subtitle: block.subtitle ?? null,
        carouselDescription: block.description ?? null,
        items: (block.items ?? []).map((item, index) =>
          videoCarouselItem(
            item,
            `${fallbackId}-item-${index}`,
            videos,
            locale,
          ),
        ),
      }
    case "infoBlocks":
      return {
        __typename: "ComponentSectionsInfoBlocks",
        id: blockId(block.sectionKey, fallbackId),
        infoHeading: block.heading ?? null,
        intro: block.intro ?? null,
        infoDescription: block.description ?? null,
        blocks: (block.blocks ?? []).map((item, index) => ({
          id: `${fallbackId}-item-${index}`,
          title: item.title ?? null,
          description: item.description ?? null,
          icon: item.icon ?? null,
        })),
      }
    case "cta":
      return {
        __typename: "ComponentSectionsCta",
        id: blockId(block.sectionKey, fallbackId),
        ctaHeading: block.heading ?? null,
        body: block.body ?? null,
        buttonLabel: block.buttonLabel ?? "",
        buttonLink: block.buttonLink ?? null,
      }
    case "promoBanner":
      return {
        __typename: "ComponentSectionsPromoBanner",
        id: blockId(block.sectionKey, fallbackId),
        promoHeading: block.heading,
        promoDescription: block.description,
        intro: block.intro ?? null,
        promoCtaLink: block.ctaLink ?? null,
      }
    case "relatedQuestions":
      return {
        __typename: "ComponentSectionsRelatedQuestions",
        id: blockId(block.sectionKey, fallbackId),
        sectionKey: block.sectionKey ?? null,
        heading: block.heading ?? null,
        ctaLabel: block.ctaLabel ?? null,
        ctaLink: block.ctaLink ?? null,
        questions: (block.questions ?? []).map((question, index) => ({
          id: `${fallbackId}-question-${index}`,
          question: question.question,
          answer: question.answer,
        })),
      }
    case "navigationCarousel":
      return {
        __typename: "ComponentSectionsNavigationCarousel",
        id: blockId(block.sectionKey, fallbackId),
        sectionKey: block.sectionKey ?? null,
        items: (block.items ?? []).map((item, index) => ({
          id: `${fallbackId}-nav-${index}`,
          contentId: item.contentId,
          title: item.title,
          category: item.category ?? null,
          imageUrl: item.imageUrl ?? null,
          backgroundColor: item.backgroundColor ?? null,
        })),
      }
    case "bibleQuotesCarousel":
      return {
        __typename: "ComponentSectionsBibleQuotesCarousel",
        id: blockId(block.sectionKey, fallbackId),
        sectionKey: block.sectionKey ?? null,
        heading: block.heading ?? null,
        quotes: (block.quotes ?? []).map((quote, index) => ({
          id: `${fallbackId}-quote-${index}`,
          reference: quote.reference,
          text: quote.text,
          attribution: quote.attribution ?? null,
          imageUrl: quote.imageUrl ?? null,
          backgroundColor: quote.backgroundColor ?? null,
          ctaLabel: quote.ctaLabel ?? null,
          ctaLink: quote.ctaLink ?? null,
        })),
      }
    case "container":
      return {
        __typename: "ComponentSectionsContainer",
        id: blockId(block.sectionKey, fallbackId),
        sectionKey: block.sectionKey ?? null,
        slots: normalizeContainerContent(
          block.content,
          fallbackId,
          videos,
          locale,
        ),
      }
    case "section":
      return {
        __typename: "ComponentSectionsSection",
        id: blockId(block.sectionKey, fallbackId),
        sectionKey: block.sectionKey ?? null,
        backgroundColor: block.backgroundColor ?? null,
        backgroundImageUrl: block.backgroundImageUrl ?? null,
        backgroundOpacity: block.backgroundOpacity ?? null,
        dynamicBackgroundImage: block.dynamicBackgroundImage ?? false,
        staticOverlay: block.staticOverlay ?? false,
        blurHash: block.blurHash ?? null,
        sectionContent: normalizeSectionContent(
          block.content,
          fallbackId,
          videos,
          locale,
        ),
      }
    case "quizButton":
      return {
        __typename: "ComponentSectionsQuizButton",
        id: fallbackId,
        buttonText: block.buttonText,
        iframeSrc: block.iframeSrc,
      }
    case "containerSlot":
      return null
  }
}

export function normalizeAdminExperience(
  experience: AdminExperience,
): NonNullable<WatchExperience> {
  const videos = new Map(
    (experience.referencedVideos ?? []).map((video) => [video.id, video]),
  )
  const blocks = experience.blocks
    .map((entry) => AdminBlockSchema.safeParse(entry))
    .flatMap((result, index) =>
      result.success
        ? [
            normalizeAdminBlock(
              result.data,
              `admin-block-${index}`,
              videos,
              experience.locale,
            ),
          ]
        : [],
    )
    .filter((block): block is NormalizedAdminBlock => block != null)

  return {
    documentId: experience.id,
    slug: experience.slug,
    isTemplate: false,
    title: experience.title ?? null,
    metaDescription: experience.metaDescription ?? null,
    ogTitle: experience.ogTitle || experience.title || null,
    ogDescription:
      experience.ogDescription || experience.metaDescription || null,
    pathSegment: null,
    ogImage: experience.ogImageUrl
      ? {
          url: experience.ogImageUrl,
          width: null,
          height: null,
          alternativeText: experience.title ?? "",
        }
      : null,
    blocks,
  } as NonNullable<WatchExperience>
}

export async function getAdminExperienceBySlug(
  locale: string,
  slug: string,
): Promise<NonNullable<WatchExperience> | null> {
  if (!env.ADMIN_GRAPHQL_URL) return null

  const response = await fetch(env.ADMIN_GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `query AdminExperienceBySlug($locale: String!, $slug: String!) {
        experienceBySlug(locale: $locale, slug: $slug) {
          id
          locale
          slug
          title
          metaDescription
          ogTitle
          ogDescription
          ogImageUrl
          blocks
          referencedVideos {
            id
            slug
            label
            locales {
              locale
              title
              description
              snippet
            }
            images {
              url
            }
            dubs {
              hls
              published
              language {
                bcp47
                iso3
                slug
              }
            }
          }
        }
      }`,
      variables: { locale, slug },
    }),
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error(`Admin content API returned ${response.status}`)
  }

  const payload = (await response.json()) as {
    data?: { experienceBySlug?: unknown | null }
    errors?: Array<{ message?: string }>
  }

  if (payload.errors?.length) {
    throw new Error(
      payload.errors
        .map((entry) => entry.message ?? "Unknown error")
        .join("; "),
    )
  }

  const parsed = AdminExperienceSchema.safeParse(payload.data?.experienceBySlug)
  if (!parsed.success) return null

  return normalizeAdminExperience(parsed.data)
}
