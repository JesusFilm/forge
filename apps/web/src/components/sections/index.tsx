import type { RouteVideo } from "@/lib/content"
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
import type { Block, VideoMap } from "./block-types"
export type { Block as Section } from "./block-types"

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

export function ExperienceSectionRenderer({
  section,
  routeVideo,
  videoMap,
}: {
  section: Block
  routeVideo?: RouteVideo | null
  videoMap?: VideoMap
}) {
  switch (section.t) {
    case "mediaCollection":
      return (
        <MediaCollection
          data={section}
          routeVideo={routeVideo}
          videoMap={videoMap}
        />
      )
    case "promoBanner":
      return <PromoBanner data={section} />
    case "infoBlocks":
      return <InfoBlocks data={section} />
    case "cta":
      return <CTASection data={section} />
    case "videoHero":
      return (
        <VideoHero data={section} routeVideo={routeVideo} videoMap={videoMap} />
      )
    case "video":
      return (
        <Video data={section} routeVideo={routeVideo} videoMap={videoMap} />
      )
    case "bibleQuotesCarousel":
      return <BibleQuotesCarousel data={section} />
    case "text":
      return <Text data={section} />
    case "adventCountdown":
      return <AdventCountdown data={section} />
    case "easterDates":
      return <EasterDates data={section} />
    case "container":
      return (
        <Container data={section} routeVideo={routeVideo} videoMap={videoMap} />
      )
    case "section":
      return (
        <SectionBlock
          data={section}
          routeVideo={routeVideo}
          videoMap={videoMap}
        />
      )
    case "relatedQuestions":
      return <RelatedQuestions data={section} />
    case "videoCarousel":
      return <CarouselVideo data={section} videoMap={videoMap} />
    case "navigationCarousel":
      return <NavigationCarousel data={section} />
    case "videoRecommendations": {
      const sourceVideo = section.sourceVideoId
        ? videoMap?.get(section.sourceVideoId)
        : null
      const slug = sourceVideo?.slug ?? routeVideo?.slug
      if (!slug) return null
      return (
        <VideoRecommendationsBlock
          slug={slug}
          locale="en"
          limit={section.limit}
          title={section.title}
        />
      )
    }
    case "card":
      return null
    default: {
      if (process.env.NODE_ENV === "development") {
        console.warn(
          "[sections] Unhandled block type:",
          (section as { t?: string }).t ?? "unknown",
        )
      }
      return null
    }
  }
}

/** @deprecated Use ExperienceSectionRenderer */
export function SectionRenderer({
  section,
  routeVideo,
  videoMap,
}: {
  section: Block
  routeVideo?: RouteVideo | null
  videoMap?: VideoMap
}) {
  return (
    <ExperienceSectionRenderer
      section={section}
      routeVideo={routeVideo}
      videoMap={videoMap}
    />
  )
}
