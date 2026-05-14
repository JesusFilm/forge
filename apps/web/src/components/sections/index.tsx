import type { ReactNode } from "react"
import type { RouteVideo, Section } from "@/lib/content"
import { MediaCollection } from "./MediaCollection"
import { PromoBanner } from "./PromoBanner"
import { InfoBlocks } from "./InfoBlocks"
import { CTASection } from "./CTASection"
import { VideoHero } from "./VideoHero"
import { Video } from "./Video"
import { BibleQuotesCarousel } from "./BibleQuotesCarousel"
import { Text } from "./Text"
import { AdventCountdown } from "./AdventCountdown"
import { EasterDates } from "./EasterDates"
import { Container } from "./Container"
import { Section as SectionBlock } from "./Section"
import { RelatedQuestions } from "./RelatedQuestions"
import { CarouselVideo } from "./CarouselVideo"
import { NavigationCarousel } from "./NavigationCarousel"
export type { Section } from "@/lib/content"

/**
 * Set of admin block typenames the renderer dispatch handles, derived
 * from the `ExperienceBlock` union members in apps/admin/schema.graphql.
 * The dispatch routes admin payloads to the same per-kind renderer the
 * Strapi cases use because admin fragments in `@forge/graphql`'s
 * `admin/fragments` sub-export adopt field aliases that match the
 * Strapi fragment vocabulary.
 *
 * Two known shape diffs the renderers tolerate at runtime:
 *
 *   1. Block-level `id` — Strapi blocks carry a string id; admin
 *      typed-union blocks don't. Renderers using `<section id={id}>`
 *      emit no id attribute on admin; section anchor lookups use
 *      `data-section-key` (from `sectionKey`), not `id`.
 *   2. `MediaCollection.items[].video` / `imageOverride` — Strapi
 *      joins the related Video row. Admin returns FLAT `videoId` +
 *      `imageUrl` only. `enrichment.ts` falls back to `titleOverride`
 *      and `imageUrl` when the join is absent; videoId hydration is a
 *      U6+ concern (out of U5 scope).
 *
 * The dispatch param type stays `Section` (Strapi-derived) — content.ts
 * is U6's scope. Admin payloads will reach this dispatch via the same
 * `section: Section` param once U6 widens `Section`; the admin
 * typename cases are wired now so the U6 patch stays small.
 */
const ADMIN_BLOCK_TYPENAMES_LIST = [
  "MediaCollectionBlock",
  "PromoBannerBlock",
  "InfoBlocksBlock",
  "CtaBlock",
  "VideoHeroBlock",
  "VideoBlock",
  "BibleQuotesCarouselBlock",
  "TextBlock",
  "AdventCountdownBlock",
  "EasterDatesBlock",
  "ContainerBlock",
  "SectionBlock",
  "RelatedQuestionsBlock",
  "VideoCarouselBlock",
  "NavigationCarouselBlock",
  "CardBlock",
  "VideoRecommendationsBlock",
] as const
type AdminBlockTypename = (typeof ADMIN_BLOCK_TYPENAMES_LIST)[number]
const ADMIN_BLOCK_TYPENAMES: ReadonlySet<string> = new Set(
  ADMIN_BLOCK_TYPENAMES_LIST,
)

type AnyBlock = {
  readonly __typename?: AdminBlockTypename | string | null
} & Record<string, unknown>

function renderAdminBlock(
  block: AnyBlock,
  routeVideo: RouteVideo | null | undefined,
): ReactNode {
  switch (block.__typename) {
    case "MediaCollectionBlock":
      return (
        <MediaCollection
          data={
            block as unknown as Parameters<typeof MediaCollection>[0]["data"]
          }
          routeVideo={routeVideo}
        />
      )
    case "PromoBannerBlock":
      return (
        <PromoBanner
          data={block as unknown as Parameters<typeof PromoBanner>[0]["data"]}
        />
      )
    case "InfoBlocksBlock":
      return (
        <InfoBlocks
          data={block as unknown as Parameters<typeof InfoBlocks>[0]["data"]}
        />
      )
    case "CtaBlock":
      return (
        <CTASection
          data={block as unknown as Parameters<typeof CTASection>[0]["data"]}
        />
      )
    case "VideoHeroBlock":
      return (
        <VideoHero
          data={block as unknown as Parameters<typeof VideoHero>[0]["data"]}
          routeVideo={routeVideo}
        />
      )
    case "VideoBlock":
      return (
        <Video
          data={block as unknown as Parameters<typeof Video>[0]["data"]}
          routeVideo={routeVideo}
        />
      )
    case "BibleQuotesCarouselBlock":
      return (
        <BibleQuotesCarousel
          data={
            block as unknown as Parameters<
              typeof BibleQuotesCarousel
            >[0]["data"]
          }
        />
      )
    case "TextBlock":
      return (
        <Text data={block as unknown as Parameters<typeof Text>[0]["data"]} />
      )
    case "AdventCountdownBlock":
      return (
        <AdventCountdown
          data={
            block as unknown as Parameters<typeof AdventCountdown>[0]["data"]
          }
        />
      )
    case "EasterDatesBlock":
      return (
        <EasterDates
          data={block as unknown as Parameters<typeof EasterDates>[0]["data"]}
        />
      )
    case "ContainerBlock":
      return (
        <Container
          data={block as unknown as Parameters<typeof Container>[0]["data"]}
          routeVideo={routeVideo}
        />
      )
    case "SectionBlock":
      return (
        <SectionBlock
          data={block as unknown as Parameters<typeof SectionBlock>[0]["data"]}
          routeVideo={routeVideo}
        />
      )
    case "RelatedQuestionsBlock":
      return (
        <RelatedQuestions
          data={
            block as unknown as Parameters<typeof RelatedQuestions>[0]["data"]
          }
        />
      )
    case "VideoCarouselBlock":
      return (
        <CarouselVideo
          data={block as unknown as Parameters<typeof CarouselVideo>[0]["data"]}
        />
      )
    case "NavigationCarouselBlock":
      return (
        <NavigationCarousel
          data={
            block as unknown as Parameters<typeof NavigationCarousel>[0]["data"]
          }
        />
      )
    case "CardBlock":
      // CardBlock has no Strapi precedent and no renderer yet. The
      // dispatch slot is reserved so the case-exhaustiveness intent
      // stays explicit — when a CardBlock renderer lands, route here.
      if (process.env.NODE_ENV === "development") {
        console.warn(
          "[sections] CardBlock dispatch reached but no renderer is wired yet.",
        )
      }
      return null
    case "VideoRecommendationsBlock": {
      // Admin's typed VideoRecommendationsBlock carries flat fields:
      // sourceVideoId / sourceSceneIndex / limit / title. There is no
      // joined `sourceVideo.slug` — admin returns the bare cuid. The
      // dispatch needs a slug to fetch recommendations; U6 will
      // resolve videoId → slug at the boundary. Until then, dev-warn.
      const adminBlock = block as {
        sourceVideoId?: string | null
        title?: string | null
        limit?: number | null
      }
      if (process.env.NODE_ENV === "development") {
        console.warn(
          "[sections] VideoRecommendationsBlock dispatch reached before U6 hydration;",
          "videoId=",
          adminBlock.sourceVideoId,
          "(needs slug to render).",
        )
      }
      return null
    }
    default: {
      // F6 (ce-code-review): if this branch fires for a typename in
      // ADMIN_BLOCK_TYPENAMES_LIST, the dispatch set and the switch have
      // drifted. Dev-warn loudly. Compile-time exhaustiveness would
      // require a stricter __typename type — AnyBlock keeps the loose
      // `string | null` so non-admin payloads (Strapi typenames) still
      // type-pass at the call site.
      if (
        process.env.NODE_ENV === "development" &&
        typeof block.__typename === "string" &&
        ADMIN_BLOCK_TYPENAMES.has(block.__typename)
      ) {
        console.warn(
          `[sections] admin typename "${block.__typename}" is in ADMIN_BLOCK_TYPENAMES but not handled by renderAdminBlock — switch/set are out of sync.`,
        )
      }
      return null
    }
  }
}

export function ExperienceSectionRenderer({
  section,
  routeVideo,
}: {
  section: Section
  routeVideo?: RouteVideo | null
}) {
  // Admin-shape dispatch — content.ts reads from admin now, so every
  // block reaching this renderer carries an admin `*Block` __typename.
  const typename = (section as { readonly __typename?: string | null })
    .__typename
  if (typename != null && ADMIN_BLOCK_TYPENAMES.has(typename)) {
    return renderAdminBlock(section as unknown as AnyBlock, routeVideo)
  }

  if (process.env.NODE_ENV === "development") {
    console.warn("[sections] Unhandled block type:", typename ?? "unknown")
  }
  return null
}

/** @deprecated Use ExperienceSectionRenderer */
export function SectionRenderer({
  section,
  routeVideo,
}: {
  section: Section
  routeVideo?: RouteVideo | null
}) {
  return <ExperienceSectionRenderer section={section} routeVideo={routeVideo} />
}
