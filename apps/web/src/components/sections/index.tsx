import { MediaCollection } from "./MediaCollection"
import { PromoBanner } from "./PromoBanner"
import { InfoBlocks } from "./InfoBlocks"
import { CTASection } from "./CTASection"
import { enrichMediaItem } from "@/lib/enrichment"

type MediaCollectionSection = {
  __typename: "ComponentSectionsMediaCollection"
  id: string
  title?: string | null
  subtitle?: string | null
  mediaDescription?: string | null
  categoryLabel?: string | null
  mediaCtaLink?: string | null
  showItemNumbers?: boolean | null
  variant: "carousel" | "collection" | "grid" | "hero" | "player"
  items?: Array<{
    id: string
    titleOverride?: string | null
    subtitleOverride?: string | null
    imageOverride?: { url: string } | null
    video?: {
      title: string
      slug: string
      image?: { url: string } | null
    } | null
  }> | null
}

export type Section =
  | MediaCollectionSection
  | {
      __typename: "ComponentSectionsPromoBanner"
      id: string
      promoHeading: string
      promoDescription: string
      intro?: string | null
      promoCtaLink: string
    }
  | {
      __typename: "ComponentSectionsInfoBlocks"
      id: string
      infoHeading?: string | null
      intro?: string | null
      infoDescription?: string | null
      blocks?: Array<{
        id: string
        title: string
        description: string
        icon: string
      }> | null
    }
  | {
      __typename: "ComponentSectionsCta"
      id: string
      ctaHeading: string
      body: string
      buttonLabel: string
      buttonLink: string
    }

export function SectionRenderer({ section }: { section: Section }) {
  switch (section.__typename) {
    case "ComponentSectionsMediaCollection":
      return (
        <MediaCollection
          id={section.id}
          title={section.title}
          subtitle={section.subtitle}
          description={section.mediaDescription}
          categoryLabel={section.categoryLabel}
          ctaLink={section.mediaCtaLink}
          showItemNumbers={section.showItemNumbers}
          variant={section.variant}
          items={(section.items ?? []).map(enrichMediaItem)}
        />
      )
    case "ComponentSectionsPromoBanner":
      return (
        <PromoBanner
          id={section.id}
          heading={section.promoHeading}
          description={section.promoDescription}
          intro={section.intro}
          ctaLink={section.promoCtaLink}
        />
      )
    case "ComponentSectionsInfoBlocks":
      return (
        <InfoBlocks
          id={section.id}
          heading={section.infoHeading}
          intro={section.intro}
          description={section.infoDescription}
          blocks={section.blocks ?? []}
        />
      )
    case "ComponentSectionsCta":
      return (
        <CTASection
          id={section.id}
          heading={section.ctaHeading}
          body={section.body}
          buttonLabel={section.buttonLabel}
          buttonLink={section.buttonLink}
        />
      )
    default:
      return null
  }
}
