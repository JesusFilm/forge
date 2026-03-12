import type { CSSProperties } from "react"
import type { FragmentOf } from "@forge/graphql"
import { CONTENT_WIDTH_CLASSES } from "@/lib/content-width"
import { sectionFragment } from "@/lib/fragments/section"
import type { bibleQuotesCarouselFragment } from "@/lib/fragments/bible-quotes-carousel"
import type { containerFragment } from "@/lib/fragments/container"
import type { mediaCollectionFragment } from "@/lib/fragments/media-collection"
import type { quizButtonSectionFragment } from "@/lib/fragments/quiz-button-section"
import type { relatedQuestionsFragment } from "@/lib/fragments/related-questions"
import type { videoSectionFragment } from "@/lib/fragments/video-section"
import { BibleQuotesCarousel } from "./BibleQuotesCarousel"
import { Container } from "./Container"
import { DynamicBackground } from "./DynamicBackground"
import { MediaCollection } from "./MediaCollection"
import { QuizButton } from "./QuizButton"
import { RelatedQuestions } from "./RelatedQuestions"
import { Video } from "./Video"

export { sectionFragment }

const BASE_BACKGROUND_OPACITY = 0.65

const BACKGROUND_CSS_VAR: Record<string, string> = {
  default: "var(--color-section-default)",
  light: "var(--color-section-light)",
  dark: "var(--color-section-dark)",
  primary: "var(--color-section-primary)",
}

const DYNAMIC_BG_CLASSES: Record<string, string> = {
  default: "bg-stone-900",
  light: "bg-stone-100",
  dark: "bg-linear-to-tr from-blue-950/10 via-purple-950/10 to-[#91214A]/90",
  primary: "bg-blue-900",
}

type SectionProps = {
  data: FragmentOf<typeof sectionFragment>
}

type SectionData = FragmentOf<typeof sectionFragment>
type SectionContentItem = NonNullable<
  NonNullable<SectionData["sectionContent"]>[number]
>

export function Section({ data }: SectionProps) {
  const { id, sectionKey, backgroundColor, backgroundOpacity, sectionContent } =
    data

  const rawDynamic = (data as Record<string, unknown>).dynamicBackgroundImage
  const isDynamicBg = rawDynamic === true

  const validContent =
    sectionContent?.filter((c): c is NonNullable<typeof c> => c != null) ?? []
  if (!validContent.length) return null

  const content = validContent.map((item, index) =>
    item && (item as { __typename?: string }).__typename !== "Error" ? (
      <SectionContentRenderer
        key={`section-${id ?? index}-${index}`}
        item={item as SectionContentItem}
      />
    ) : null,
  )

  if (isDynamicBg) {
    const bgClass =
      DYNAMIC_BG_CLASSES[backgroundColor ?? "default"] ??
      DYNAMIC_BG_CLASSES.default

    return (
      <section
        id={id ?? undefined}
        data-section-key={sectionKey ?? undefined}
        data-testid="Section"
        className="relative w-full"
      >
        <DynamicBackground bgClass={bgClass}>{content}</DynamicBackground>
      </section>
    )
  }

  const opacity =
    backgroundOpacity != null ? backgroundOpacity : BASE_BACKGROUND_OPACITY
  const rgb =
    BACKGROUND_CSS_VAR[backgroundColor ?? "default"] ??
    BACKGROUND_CSS_VAR.default

  const backgroundStyle: CSSProperties = {
    backgroundColor: `rgb(${rgb} / ${opacity})`,
  }

  return (
    <section
      id={id ?? undefined}
      data-section-key={sectionKey ?? undefined}
      data-testid="Section"
      className="relative w-full"
    >
      <div
        className="mx-auto w-full backdrop-blur-md md:max-w-[1920px]"
        style={backgroundStyle}
      >
        <div
          className={`flex flex-col items-stretch justify-center gap-10 py-10 pb-16 ${CONTENT_WIDTH_CLASSES}`}
        >
          {content}
        </div>
      </div>
    </section>
  )
}

function SectionContentRenderer({ item }: { item: SectionContentItem }) {
  if (!item || item.__typename === "Error") return null
  const typename = item.__typename as string
  switch (typename) {
    case "ComponentSectionsContainer":
      return (
        <Container
          data={item as unknown as FragmentOf<typeof containerFragment>}
        />
      )
    case "ComponentSectionsVideo":
      return (
        <Video
          data={item as unknown as FragmentOf<typeof videoSectionFragment>}
        />
      )
    case "ComponentSectionsRelatedQuestions":
      return (
        <RelatedQuestions
          data={item as unknown as FragmentOf<typeof relatedQuestionsFragment>}
        />
      )
    case "ComponentSectionsBibleQuotesCarousel":
      return (
        <BibleQuotesCarousel
          data={
            item as unknown as FragmentOf<typeof bibleQuotesCarouselFragment>
          }
        />
      )
    case "ComponentSectionsMediaCollection":
      return (
        <MediaCollection
          data={item as unknown as FragmentOf<typeof mediaCollectionFragment>}
        />
      )
    case "ComponentSectionsQuizButton":
      return (
        <QuizButton
          data={item as unknown as FragmentOf<typeof quizButtonSectionFragment>}
        />
      )
    default: {
      if (process.env.NODE_ENV === "development") {
        console.warn("[Section] Unhandled content type:", typename)
      }
      return null
    }
  }
}
