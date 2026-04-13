import type { NormalizedBlock } from "../../lib/normalizer"
import { SectionWrapperRenderer } from "./SectionWrapperRenderer"
import { ContainerRenderer } from "./ContainerRenderer"
import { VideoHeroRenderer } from "./VideoHeroRenderer"
import { VideoCardRenderer } from "./VideoCardRenderer"
import { TextRenderer } from "./TextRenderer"
import { BibleQuotesCarouselRenderer } from "./BibleQuotesCarouselRenderer"
import { PlaceholderRenderer } from "./PlaceholderRenderer"

export interface SectionDispatcherProps {
  section: NormalizedBlock
}

export function SectionDispatcher({ section }: SectionDispatcherProps) {
  const { kind } = section

  switch (kind) {
    case "sectionWrapper":
      return <SectionWrapperRenderer section={section} />
    case "container":
      return <ContainerRenderer section={section} />
    case "videoHero":
      return <VideoHeroRenderer section={section} />
    case "video":
      return <VideoCardRenderer section={section} />
    case "text":
      return <TextRenderer section={section} />
    case "bibleQuotesCarousel":
      return <BibleQuotesCarouselRenderer section={section} />
    default:
      return <PlaceholderRenderer section={section} />
  }
}
