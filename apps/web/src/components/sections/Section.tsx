import type {
  FragmentOf,
  LegacyFragmentValue,
} from "@/lib/legacy-fragment-types"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import type { RouteVideo } from "@/lib/content"
import { sectionFragment } from "@/lib/fragments/section"
import type { bibleQuotesCarouselFragment } from "@/lib/fragments/bible-quotes-carousel"
import type { containerFragment } from "@/lib/fragments/container"
import type { mediaCollectionFragment } from "@/lib/fragments/media-collection"
import type { relatedQuestionsFragment } from "@/lib/fragments/related-questions"
import type { navigationCarouselFragment } from "@/lib/fragments/navigation-carousel"
import type { videoCarouselFragment } from "@/lib/fragments/video-carousel"
import type { videoSectionFragment } from "@/lib/fragments/video-section"
import { BibleQuotesCarousel } from "./BibleQuotesCarousel"
import { Container } from "./Container"
import { DynamicBackground } from "./DynamicBackground"
import { MediaCollection } from "./MediaCollection"
import { CarouselVideo } from "./CarouselVideo"
import { NavigationCarousel } from "./NavigationCarousel"
import { QuizButton } from "./QuizButton"
import { RelatedQuestions } from "./RelatedQuestions"
import { Video } from "./Video"
import { AdventCountdown } from "./AdventCountdown"
import { CTASection } from "./CTASection"
import { EasterDates } from "./EasterDates"
import { InfoBlocks } from "./InfoBlocks"
import { PromoBanner } from "./PromoBanner"
import { Text } from "./Text"

// Admin GraphQL typenames for blocks that can appear nested inside a
// SectionBlock's `content[]`. The Strapi switch above only knows
// `ComponentSections*` typenames; admin's payloads carry these instead.
// We inline the dispatch (rather than reusing `renderAdminBlock` from
// `./index`) to avoid an import cycle — `index.tsx` already imports
// `Section.tsx`, so the reverse import resolves undefined at module
// load and the component silently no-ops.

export { sectionFragment }

const BASE_BACKGROUND_OPACITY = 0.65

const BACKGROUND_CSS_VAR: Record<string, string> = {
  default: "var(--color-section-default)",
  light: "var(--color-section-light)",
  dark: "var(--color-section-dark)",
  primary: "var(--color-section-primary)",
  cosmic: "var(--color-section-cosmic)",
  purple: "var(--color-section-purple)",
}

const SECTION_BG_CLASSES: Record<string, string> = {
  default: "bg-stone-800",
  light: "bg-stone-100",
  dark: "bg-stone-900",
  primary: "bg-blue-900",
  cosmic: "bg-linear-to-tr from-violet-950/10 via-indigo-500/10 to-cyan-300/50",
  purple: "bg-linear-to-tr from-blue-950/10 via-purple-950/10 to-[#91214A]/90",
}

const SECTION_TEXT_COLOR: Record<string, string> = {
  default: "text-white",
  light: "text-stone-900",
  dark: "text-white",
  primary: "text-white",
  cosmic: "text-white",
  purple: "text-white",
}

function isHexColor(value: unknown) {
  return /^#[0-9a-fA-F]{6}$/.test(typeof value === "string" ? value.trim() : "")
}

type SectionProps = {
  data: FragmentOf<typeof sectionFragment>
  routeVideo?: RouteVideo | null
  languageSlug?: string | null
}

type SectionData = FragmentOf<typeof sectionFragment>
type SectionContentItem = NonNullable<
  NonNullable<SectionData["sectionContent"]>[number]
>

export function Section({ data, routeVideo, languageSlug }: SectionProps) {
  const {
    id,
    sectionKey,
    backgroundColor,
    backgroundImageUrl,
    backgroundOpacity,
    sectionContent,
  } = data

  const raw = data as Record<string, unknown>
  const isDynamicBg = raw.dynamicBackgroundImage === true
  const hasStaticOverlay = raw.staticOverlay === true

  const validContent =
    sectionContent?.filter(
      (c: LegacyFragmentValue): c is NonNullable<typeof c> => c != null,
    ) ?? []
  if (!validContent.length) return null

  const content = validContent.map((item: SectionContentItem, index: number) =>
    item && (item as { __typename?: string }).__typename !== "Error" ? (
      <SectionContentRenderer
        key={`section-${id ?? index}-${index}`}
        item={item as SectionContentItem}
        routeVideo={routeVideo}
        languageSlug={languageSlug}
      />
    ) : null,
  )

  const textColor =
    SECTION_TEXT_COLOR[backgroundColor ?? "default"] ??
    SECTION_TEXT_COLOR.default

  if (isDynamicBg) {
    const bgClass =
      SECTION_BG_CLASSES[backgroundColor ?? "default"] ??
      SECTION_BG_CLASSES.default

    return (
      <section
        id={id ?? undefined}
        data-section-key={sectionKey ?? undefined}
        data-testid="Section"
        className={`relative w-full overflow-hidden ${textColor}`}
      >
        {hasStaticOverlay && (
          <div
            className="pointer-events-none absolute inset-0 z-1 bg-repeat mix-blend-multiply"
            style={{
              backgroundImage: 'url("/watch/images/overlay.svg")',
            }}
            aria-hidden="true"
          />
        )}
        <div className="relative z-2">
          <DynamicBackground bgClass={bgClass}>{content}</DynamicBackground>
        </div>
      </section>
    )
  }

  const bgKey = backgroundColor ?? "default"
  const bgClass = SECTION_BG_CLASSES[bgKey] ?? SECTION_BG_CLASSES.default

  const opacity =
    backgroundOpacity != null ? backgroundOpacity : BASE_BACKGROUND_OPACITY
  const rgb = BACKGROUND_CSS_VAR[bgKey] ?? BACKGROUND_CSS_VAR.default
  const explicitBackgroundColor = isHexColor(backgroundColor)
    ? backgroundColor
    : undefined
  const backgroundStyle = explicitBackgroundColor
    ? { backgroundColor: explicitBackgroundColor }
    : { backgroundColor: `rgb(${rgb} / ${opacity})` }

  return (
    <section
      id={id ?? undefined}
      data-section-key={sectionKey ?? undefined}
      data-testid="Section"
      className={`relative w-full ${textColor}`}
    >
      <div
        className={`mx-auto w-full backdrop-blur-2xl md:max-w-[1920px] ${bgClass} ${hasStaticOverlay || backgroundImageUrl ? "relative overflow-hidden" : ""}`}
        style={backgroundStyle}
      >
        {backgroundImageUrl ? (
          <div
            className="absolute inset-0 bg-cover bg-center opacity-45"
            style={{ backgroundImage: `url("${backgroundImageUrl}")` }}
            aria-hidden="true"
          />
        ) : null}
        {backgroundImageUrl ? (
          <div className="absolute inset-0 bg-black/35" aria-hidden="true" />
        ) : null}
        {hasStaticOverlay && (
          <div
            className="absolute inset-0 z-1 bg-repeat mix-blend-multiply"
            style={{
              backgroundImage: 'url("/watch/images/overlay.svg")',
            }}
            aria-hidden="true"
          />
        )}
        <div
          className={`${hasStaticOverlay || backgroundImageUrl ? "relative z-2 " : ""}flex flex-col items-stretch justify-center gap-10 py-10 pb-16 ${WATCH_PAGE_CONTENT_CLASSES}`}
        >
          {content}
        </div>
      </div>
    </section>
  )
}

function SectionContentRenderer({
  item,
  routeVideo,
  languageSlug,
}: {
  item: SectionContentItem
  routeVideo?: RouteVideo | null
  languageSlug?: string | null
}) {
  if (!item || item.__typename === "Error") return null
  const typename = item.__typename as string
  // Cast to broader string so the admin typename cases below (which
  // are not in the Strapi-derived discriminated union) type-check.
  switch (typename as string) {
    case "ComponentSectionsContainer":
      return (
        <Container
          data={item as unknown as FragmentOf<typeof containerFragment>}
          routeVideo={routeVideo}
          languageSlug={languageSlug}
        />
      )
    case "ComponentSectionsVideo":
      return (
        <Video
          data={item as unknown as FragmentOf<typeof videoSectionFragment>}
          routeVideo={routeVideo}
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
          routeVideo={routeVideo}
          languageSlug={languageSlug}
        />
      )
    case "ComponentSectionsQuizButton":
      return (
        <QuizButton
          data={
            item as unknown as {
              id: string
              buttonText: string
              iframeSrc: string
            }
          }
        />
      )
    case "ComponentSectionsVideoCarousel":
      return (
        <CarouselVideo
          data={item as unknown as FragmentOf<typeof videoCarouselFragment>}
        />
      )
    case "ComponentSectionsNavigationCarousel":
      return (
        <NavigationCarousel
          data={
            item as unknown as FragmentOf<typeof navigationCarouselFragment>
          }
        />
      )
    // Admin GraphQL typenames inlined here. See module-level comment for
    // why we don't bounce through `renderAdminBlock` in `./index`.
    case "ContainerBlock":
      return (
        <Container
          data={item as unknown as FragmentOf<typeof containerFragment>}
          routeVideo={routeVideo}
          languageSlug={languageSlug}
        />
      )
    case "VideoBlock":
      return (
        <Video
          data={item as unknown as FragmentOf<typeof videoSectionFragment>}
          routeVideo={routeVideo}
        />
      )
    case "TextBlock":
      return (
        <Text data={item as unknown as Parameters<typeof Text>[0]["data"]} />
      )
    case "CtaBlock":
      return (
        <CTASection
          data={item as unknown as Parameters<typeof CTASection>[0]["data"]}
        />
      )
    case "EasterDatesBlock":
      return (
        <EasterDates
          data={item as unknown as Parameters<typeof EasterDates>[0]["data"]}
        />
      )
    case "AdventCountdownBlock":
      return (
        <AdventCountdown
          data={
            item as unknown as Parameters<typeof AdventCountdown>[0]["data"]
          }
        />
      )
    case "BibleQuotesCarouselBlock":
      return (
        <BibleQuotesCarousel
          data={
            item as unknown as FragmentOf<typeof bibleQuotesCarouselFragment>
          }
        />
      )
    case "MediaCollectionBlock":
      return (
        <MediaCollection
          data={item as unknown as FragmentOf<typeof mediaCollectionFragment>}
          routeVideo={routeVideo}
          languageSlug={languageSlug}
        />
      )
    case "NavigationCarouselBlock":
      return (
        <NavigationCarousel
          data={
            item as unknown as FragmentOf<typeof navigationCarouselFragment>
          }
        />
      )
    case "RelatedQuestionsBlock":
      return (
        <RelatedQuestions
          data={item as unknown as FragmentOf<typeof relatedQuestionsFragment>}
        />
      )
    case "QuizButtonBlock":
      return (
        <QuizButton
          data={
            item as unknown as {
              id: string
              buttonText: string
              iframeSrc: string
            }
          }
        />
      )
    case "VideoCarouselBlock":
      return (
        <CarouselVideo
          data={item as unknown as FragmentOf<typeof videoCarouselFragment>}
        />
      )
    case "PromoBannerBlock":
      return (
        <PromoBanner
          data={item as unknown as Parameters<typeof PromoBanner>[0]["data"]}
        />
      )
    case "InfoBlocksBlock":
      return (
        <InfoBlocks
          data={item as unknown as Parameters<typeof InfoBlocks>[0]["data"]}
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
