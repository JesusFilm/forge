import type { Section } from "@/lib/content"
import { MediaCollection } from "./MediaCollection"
import { PromoBanner } from "./PromoBanner"
import { InfoBlocks } from "./InfoBlocks"
import { CTASection } from "./CTASection"
import { BibleQuotesCarousel } from "./BibleQuotesCarousel"

export type { Section } from "@/lib/content"

export function SectionRenderer({ section }: { section: Section }) {
  switch (section.__typename) {
    case "ComponentSectionsMediaCollection":
      return <MediaCollection data={section} />
    case "ComponentSectionsPromoBanner":
      return <PromoBanner data={section} />
    case "ComponentSectionsInfoBlocks":
      return <InfoBlocks data={section} />
    case "ComponentSectionsCta":
      return <CTASection data={section} />
    case "ComponentSectionsBibleQuotesCarousel":
      return <BibleQuotesCarousel data={section} />
    default: {
      // Unknown section types are intentionally skipped until implemented.
      return null
    }
  }
}
