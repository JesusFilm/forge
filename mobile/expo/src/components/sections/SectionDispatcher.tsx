import { View } from "react-native"

import type { ExperienceSection, SectionContent } from "../../lib/sectionModels"
import { BibleQuotesCarouselRenderer } from "./BibleQuotesCarouselStub"
import { CTARenderer } from "./CTARenderer"
import { CardRenderer } from "./CardStub"
import { ContainerRenderer } from "./ContainerStub"
import { MediaCollectionRenderer } from "./MediaCollectionStub"
import { RelatedQuestionsRenderer } from "./RelatedQuestionsStub"
import { SectionWrapperRenderer } from "./SectionWrapperStub"
import { TextRenderer } from "./TextRenderer"
import { VideoRenderer } from "./VideoRenderer"
import { VideoHeroRenderer } from "./VideoHeroRenderer"

/**
 * Renders a single content item (used inside Container slots and
 * SectionWrapper content for recursive dispatch).
 */
function renderContent(section: SectionContent): React.ReactNode {
  switch (section.kind) {
    case "mediaCollection":
      return <MediaCollectionRenderer section={section} />
    case "cta":
      return <CTARenderer section={section} />
    case "text":
      return <TextRenderer section={section} />
    case "relatedQuestions":
      return <RelatedQuestionsRenderer section={section} />
    case "bibleQuotesCarousel":
      return <BibleQuotesCarouselRenderer section={section} />
    case "card":
      return <CardRenderer section={section} />
    case "video":
      return <VideoRenderer section={section} />
    case "container":
      return <ContainerRenderer section={section} />
    default:
      console.warn(
        `SectionDispatcher: unknown content kind "${(section as { kind: string }).kind}"`,
      )
      return null
  }
}

/**
 * Renders nested content arrays (Container slots, SectionWrapper content).
 */
export function ContentDispatcher({ content }: { content: SectionContent[] }) {
  return (
    <View>
      {content.map((item) => (
        <View key={item.id}>{renderContent(item)}</View>
      ))}
    </View>
  )
}

/**
 * Renders a top-level ExperienceSection by dispatching on `kind`.
 * Returns null for unknown kinds with a console warning.
 */
export function SectionDispatcher({ section }: { section: ExperienceSection }) {
  switch (section.kind) {
    case "videoHero":
      return <VideoHeroRenderer section={section} />
    case "mediaCollection":
      return <MediaCollectionRenderer section={section} />
    case "cta":
      return <CTARenderer section={section} />
    case "text":
      return <TextRenderer section={section} />
    case "relatedQuestions":
      return <RelatedQuestionsRenderer section={section} />
    case "bibleQuotesCarousel":
      return <BibleQuotesCarouselRenderer section={section} />
    case "card":
      return <CardRenderer section={section} />
    case "video":
      return <VideoRenderer section={section} />
    case "container":
      return <ContainerRenderer section={section} />
    case "sectionWrapper":
      return <SectionWrapperRenderer section={section} />
    default:
      console.warn(
        `SectionDispatcher: unknown section kind "${(section as { kind: string }).kind}"`,
      )
      return null
  }
}
