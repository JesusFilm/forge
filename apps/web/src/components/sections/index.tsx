import type { Section } from "@/lib/content"
import { MediaCollection } from "./MediaCollection"
import { PromoBanner } from "./PromoBanner"
import { InfoBlocks } from "./InfoBlocks"
import { CTASection } from "./CTASection"
import { VideoHero } from "./VideoHero"
import { BibleQuotesCarousel } from "./BibleQuotesCarousel"

export type { Section } from "@/lib/content"

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
    case "ComponentSectionsBibleQuotesCarousel":
      return <BibleQuotesCarousel data={section} />
    default: {
      // Unhandled block types (e.g. Section, Container, Text) render nothing
      return null
    }
  }
}

/** @deprecated Use ExperienceSectionRenderer */
export function SectionRenderer({ section }: { section: Section }) {
  return <ExperienceSectionRenderer section={section} />
}
