import type { CSSProperties } from "react"
import type { FragmentOf } from "@forge/graphql"
import { CONTENT_WIDTH_CLASSES } from "@/lib/content-width"
import { sectionFragment } from "@/lib/fragments/section"
import type { containerFragment } from "@/lib/fragments/container"
import type { relatedQuestionsFragment } from "@/lib/fragments/related-questions"
import type { videoSectionFragment } from "@/lib/fragments/video-section"
import type { bibleQuotesCarouselFragment } from "@/lib/fragments/bible-quotes-carousel"
import { BibleQuotesCarousel } from "./BibleQuotesCarousel"
import { Container } from "./Container"
import { Video } from "./Video"
import { RelatedQuestions } from "./RelatedQuestions"
import { DynamicBackgroundSection } from "./DynamicBackgroundSection"

export { sectionFragment }

const BASE_BACKGROUND_OPACITY = 0.65

const BACKGROUND_CSS_VAR: Record<string, string> = {
  default: "var(--color-section-default)",
  light: "var(--color-section-light)",
  dark: "var(--color-section-dark)",
  primary: "var(--color-section-primary)",
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

  if (isDynamicBg) {
    return (
      <DynamicBackgroundSection
        id={id}
        sectionKey={sectionKey}
        backgroundColor={backgroundColor}
        content={validContent}
      />
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
          {validContent.map((item, index) =>
            item && (item as { __typename?: string }).__typename !== "Error" ? (
              <SectionContentRenderer
                key={`section-${id ?? index}-${index}`}
                item={item as SectionContentItem}
              />
            ) : null,
          )}
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
    default: {
      if (process.env.NODE_ENV === "development") {
        console.warn("[Section] Unhandled content type:", typename)
      }
      return null
    }
  }
}
