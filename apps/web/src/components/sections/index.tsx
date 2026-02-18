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
  description?: string | null
  categoryLabel?: string | null
  ctaLink?: string | null
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
      heading: string
      description: string
      intro?: string | null
      ctaLink: string
    }
  | {
      __typename: "ComponentSectionsInfoBlocks"
      id: string
      heading?: string | null
      intro?: string | null
      description?: string | null
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
      heading: string
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
          description={section.description}
          categoryLabel={section.categoryLabel}
          ctaLink={section.ctaLink}
          showItemNumbers={section.showItemNumbers}
          variant={section.variant}
          items={(section.items ?? []).map(enrichMediaItem)}
        />
      )
    case "ComponentSectionsPromoBanner":
      return (
        <PromoBanner
          id={section.id}
          heading={section.heading}
          description={section.description}
          intro={section.intro}
          ctaLink={section.ctaLink}
        />
      )
    case "ComponentSectionsInfoBlocks":
      return (
        <InfoBlocks
          id={section.id}
          heading={section.heading}
          intro={section.intro}
          description={section.description}
          blocks={section.blocks ?? []}
        />
      )
    case "ComponentSectionsCta":
      return (
        <CTASection
          id={section.id}
          heading={section.heading}
          body={section.body}
          buttonLabel={section.buttonLabel}
          buttonLink={section.buttonLink}
        />
      )
    default:
      return null
  }
}
