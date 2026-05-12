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
import { VideoRecommendations } from "./VideoRecommendations"
import { getSceneRecommendations } from "@/lib/recommendations"
export type { Section } from "@/lib/content"

async function VideoRecommendationsBlock({
  slug,
  locale,
  limit,
  title,
}: {
  slug: string
  locale: string
  limit: number
  title?: string
}) {
  const recommendations = await getSceneRecommendations(slug, locale, limit)
  return (
    <div>
      {title && (
        <h2 className="mb-6 text-xl font-semibold text-white">{title}</h2>
      )}
      <VideoRecommendations recommendations={recommendations} locale={locale} />
    </div>
  )
}

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
const ADMIN_BLOCK_TYPENAMES = new Set<string>([
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
])

type AnyBlock = {
  readonly __typename?: string | null
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
    default:
      return null
  }
}

export function ExperienceSectionRenderer({
  section,
  routeVideo,
}: {
  section: Section
  routeVideo?: RouteVideo | null
}) {
  // Admin-shape dispatch — only reachable post-U6 when content.ts cuts
  // over. The Strapi `Section` discriminator union doesn't include the
  // admin typenames, so the check goes through a loose-typed view first
  // and short-circuits before TS's narrowing kicks in below.
  const typename = (section as { readonly __typename?: string | null })
    .__typename
  if (typename != null && ADMIN_BLOCK_TYPENAMES.has(typename)) {
    return renderAdminBlock(section as unknown as AnyBlock, routeVideo)
  }

  switch (section.__typename) {
    case "ComponentSectionsMediaCollection":
      return <MediaCollection data={section} routeVideo={routeVideo} />
    case "ComponentSectionsPromoBanner":
      return <PromoBanner data={section} />
    case "ComponentSectionsInfoBlocks":
      return <InfoBlocks data={section} />
    case "ComponentSectionsCta":
      return <CTASection data={section} />
    case "ComponentSectionsVideoHero":
      return <VideoHero data={section} routeVideo={routeVideo} />
    case "ComponentSectionsVideo":
      return <Video data={section} routeVideo={routeVideo} />
    case "ComponentSectionsBibleQuotesCarousel":
      return <BibleQuotesCarousel data={section} />
    case "ComponentSectionsText":
      return <Text data={section} />
    case "ComponentSectionsAdventCountdown":
      return <AdventCountdown data={section} />
    case "ComponentSectionsEasterDates":
      return <EasterDates data={section} />
    case "ComponentSectionsContainer":
      return <Container data={section} routeVideo={routeVideo} />
    case "ComponentSectionsSection":
      return <SectionBlock data={section} routeVideo={routeVideo} />
    case "ComponentSectionsRelatedQuestions":
      return <RelatedQuestions data={section} />
    case "ComponentSectionsVideoCarousel":
      return <CarouselVideo data={section} />
    case "ComponentSectionsNavigationCarousel":
      return <NavigationCarousel data={section} />
    default: {
      // Forward-looking: handle VideoRecommendations block before codegen
      // adds it to the Section union type. Once the Strapi component
      // ComponentBlocksVideoRecommendations exists and codegen runs, move
      // this to a proper case above.
      const tn = (section as { __typename?: string }).__typename
      if (tn === "ComponentBlocksVideoRecommendations") {
        const block = section as {
          sourceVideo?: { slug?: string } | null
          title?: string | null
          limit?: number | null
          locale?: string | null
        }
        const slug = block.sourceVideo?.slug
        if (!slug) return null
        const locale = block.locale ?? "en"
        const limit = block.limit ?? 10
        return (
          <VideoRecommendationsBlock
            slug={slug}
            locale={locale}
            limit={limit}
            title={block.title ?? undefined}
          />
        )
      }
      if (process.env.NODE_ENV === "development") {
        console.warn("[sections] Unhandled block type:", tn ?? "unknown")
      }
      return null
    }
  }
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
