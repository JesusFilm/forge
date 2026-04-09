import type { Section } from "@/lib/content"
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

export function ExperienceSectionRenderer({ section }: { section: Section }) {
  switch (section.__typename) {
    case "ComponentSectionsMediaCollection":
      return <MediaCollection data={section} />
    case "ComponentSectionsPromoBanner":
      return <PromoBanner data={section} />
    case "ComponentSectionsInfoBlocks":
      return <InfoBlocks data={section} />
    case "ComponentSectionsCta":
      return <CTASection data={section} />
    case "ComponentSectionsVideoHero":
      return <VideoHero data={section} />
    case "ComponentSectionsVideo":
      return <Video data={section} />
    case "ComponentSectionsBibleQuotesCarousel":
      return <BibleQuotesCarousel data={section} />
    case "ComponentSectionsText":
      return <Text data={section} />
    case "ComponentSectionsAdventCountdown":
      return <AdventCountdown data={section} />
    case "ComponentSectionsEasterDates":
      return <EasterDates data={section} />
    case "ComponentSectionsContainer":
      return <Container data={section} />
    case "ComponentSectionsSection":
      return <SectionBlock data={section} />
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
export function SectionRenderer({ section }: { section: Section }) {
  return <ExperienceSectionRenderer section={section} />
}
