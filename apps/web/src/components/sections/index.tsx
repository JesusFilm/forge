import type { ReactNode } from "react"
import dynamic from "next/dynamic"
import type { RouteVideo, Section } from "@/lib/content"
// Heavy section components are split into separate chunks so unused
// renderers (every block this page doesn't use) stay out of the main
// route bundle. Default `ssr: true` keeps SSR markup identical.
// Type-only imports stay (zero runtime cost) so `Parameters<typeof X>`
// callsites in the dispatch switch keep their original signatures.
import type { MediaCollection as MediaCollectionType } from "./MediaCollection"
import type { PromoBanner as PromoBannerType } from "./PromoBanner"
import type { InfoBlocks as InfoBlocksType } from "./InfoBlocks"
import type { CTASection as CTASectionType } from "./CTASection"
import type { VideoHero as VideoHeroType } from "./VideoHero"
import type { Video as VideoType } from "./Video"
import type { BibleQuotesCarousel as BibleQuotesCarouselType } from "./BibleQuotesCarousel"
import type { Text as TextType } from "./Text"
import type { AdventCountdown as AdventCountdownType } from "./AdventCountdown"
import type { EasterDates as EasterDatesType } from "./EasterDates"
import type { Container as ContainerType } from "./Container"
import type { Section as SectionBlockType } from "./Section"
import type { RelatedQuestions as RelatedQuestionsType } from "./RelatedQuestions"
import type { CarouselVideo as CarouselVideoType } from "./CarouselVideo"
import type { NavigationCarousel as NavigationCarouselType } from "./NavigationCarousel"
import type { LanguageGlobe as LanguageGlobeType } from "./LanguageGlobe"
const MediaCollection = dynamic(() =>
  import("./MediaCollection").then((m) => ({ default: m.MediaCollection })),
) as typeof MediaCollectionType
const PromoBanner = dynamic(() =>
  import("./PromoBanner").then((m) => ({ default: m.PromoBanner })),
) as typeof PromoBannerType
const InfoBlocks = dynamic(() =>
  import("./InfoBlocks").then((m) => ({ default: m.InfoBlocks })),
) as typeof InfoBlocksType
const CTASection = dynamic(() =>
  import("./CTASection").then((m) => ({ default: m.CTASection })),
) as typeof CTASectionType
const VideoHero = dynamic(() =>
  import("./VideoHero").then((m) => ({ default: m.VideoHero })),
) as typeof VideoHeroType
const Video = dynamic(() =>
  import("./Video").then((m) => ({ default: m.Video })),
) as typeof VideoType
const BibleQuotesCarousel = dynamic(() =>
  import("./BibleQuotesCarousel").then((m) => ({
    default: m.BibleQuotesCarousel,
  })),
) as typeof BibleQuotesCarouselType
const Text = dynamic(() =>
  import("./Text").then((m) => ({ default: m.Text })),
) as typeof TextType
const AdventCountdown = dynamic(() =>
  import("./AdventCountdown").then((m) => ({ default: m.AdventCountdown })),
) as typeof AdventCountdownType
const EasterDates = dynamic(() =>
  import("./EasterDates").then((m) => ({ default: m.EasterDates })),
) as typeof EasterDatesType
const Container = dynamic(() =>
  import("./Container").then((m) => ({ default: m.Container })),
) as typeof ContainerType
const SectionBlock = dynamic(() =>
  import("./Section").then((m) => ({ default: m.Section })),
) as typeof SectionBlockType
const RelatedQuestions = dynamic(() =>
  import("./RelatedQuestions").then((m) => ({ default: m.RelatedQuestions })),
) as typeof RelatedQuestionsType
const CarouselVideo = dynamic(() =>
  import("./CarouselVideo").then((m) => ({ default: m.CarouselVideo })),
) as typeof CarouselVideoType
const NavigationCarousel = dynamic(() =>
  import("./NavigationCarousel").then((m) => ({
    default: m.NavigationCarousel,
  })),
) as typeof NavigationCarouselType
const LanguageGlobe = dynamic(() =>
  import("./LanguageGlobe").then((m) => ({ default: m.LanguageGlobe })),
) as typeof LanguageGlobeType
export type { Section } from "@/lib/content"

/**
 * Set of admin block typenames the renderer dispatch handles, derived
 * from the `ExperienceBlock` union members in apps/admin/schema.graphql.
 * The dispatch routes admin payloads to the same per-kind renderer the
 * Strapi cases use because admin fragments in `@forge/admin-graphql`'s
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
  "WatchHomeHeroBlock",
  "LanguageGlobeBlock",
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
  languageSlug: string | null | undefined,
): ReactNode {
  switch (block.__typename) {
    case "MediaCollectionBlock":
      return (
        <MediaCollection
          data={
            block as unknown as Parameters<typeof MediaCollection>[0]["data"]
          }
          routeVideo={routeVideo}
          languageSlug={languageSlug}
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
          languageSlug={languageSlug}
        />
      )
    case "SectionBlock":
      return (
        <SectionBlock
          data={block as unknown as Parameters<typeof SectionBlock>[0]["data"]}
          routeVideo={routeVideo}
          languageSlug={languageSlug}
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
    case "LanguageGlobeBlock":
      return (
        <LanguageGlobe
          data={block as unknown as Parameters<typeof LanguageGlobe>[0]["data"]}
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
    case "WatchHomeHeroBlock":
      // The Watch homepage route renders this placeholder with the static
      // hero model it already resolved. Other routes deliberately ignore it.
      return null
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
  languageSlug,
}: {
  section: Section
  routeVideo?: RouteVideo | null
  languageSlug?: string | null
}) {
  // Admin-shape dispatch — content.ts reads from admin now, so every
  // block reaching this renderer carries an admin `*Block` __typename.
  const typename = (section as { readonly __typename?: string | null })
    .__typename
  if (typename != null && ADMIN_BLOCK_TYPENAMES.has(typename)) {
    return renderAdminBlock(
      section as unknown as AnyBlock,
      routeVideo,
      languageSlug,
    )
  }

  if (process.env.NODE_ENV === "development") {
    console.warn("[sections] Unhandled block type:", typename ?? "unknown")
  }
  return null
}
