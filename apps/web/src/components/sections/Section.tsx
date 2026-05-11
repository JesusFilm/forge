import { CONTENT_WIDTH_CLASSES } from "@/lib/content-width"
import type { RouteVideo } from "@/lib/content"
import { BibleQuotesCarousel } from "./BibleQuotesCarousel"
import { Container } from "./Container"
import { CTASection } from "./CTASection"
import { DynamicBackground } from "./DynamicBackground"
import { InfoBlocks } from "./InfoBlocks"
import { MediaCollection } from "./MediaCollection"
import { CarouselVideo } from "./CarouselVideo"
import { NavigationCarousel } from "./NavigationCarousel"
import { PromoBanner } from "./PromoBanner"
import { QuizButton } from "./QuizButton"
import { RelatedQuestions } from "./RelatedQuestions"
import { Text } from "./Text"
import { Video } from "./Video"
import type { SectionBlock, SectionContentBlock, VideoMap } from "./block-types"

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
  data: SectionBlock
  routeVideo?: RouteVideo | null
  videoMap?: VideoMap
}

type SectionContentItem = SectionContentBlock

export function Section({ data, routeVideo, videoMap }: SectionProps) {
  const {
    sectionKey,
    backgroundColor,
    backgroundImageUrl,
    backgroundOpacity,
    content: sectionContent,
  } = data

  const raw = data as Record<string, unknown>
  const isDynamicBg = raw.dynamicBackgroundImage === true
  const hasStaticOverlay = raw.staticOverlay === true

  const validContent =
    sectionContent?.filter((c): c is NonNullable<typeof c> => c != null) ?? []
  if (!validContent.length) return null

  const content = validContent.map((item, index) =>
    item ? (
      <SectionContentRenderer
        key={`section-${sectionKey ?? index}-${item.sectionKey ?? index}`}
        item={item as SectionContentItem}
        routeVideo={routeVideo}
        videoMap={videoMap}
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
        id={sectionKey ?? undefined}
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
      id={sectionKey ?? undefined}
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
          className={`${hasStaticOverlay || backgroundImageUrl ? "relative z-2 " : ""}flex flex-col items-stretch justify-center gap-10 py-10 pb-16 ${CONTENT_WIDTH_CLASSES}`}
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
  videoMap,
}: {
  item: SectionContentItem
  routeVideo?: RouteVideo | null
  videoMap?: VideoMap
}) {
  switch (item.t) {
    case "container":
      return (
        <Container data={item} routeVideo={routeVideo} videoMap={videoMap} />
      )
    case "video":
      return <Video data={item} routeVideo={routeVideo} videoMap={videoMap} />
    case "relatedQuestions":
      return <RelatedQuestions data={item} />
    case "bibleQuotesCarousel":
      return <BibleQuotesCarousel data={item} />
    case "mediaCollection":
      return (
        <MediaCollection
          data={item}
          routeVideo={routeVideo}
          videoMap={videoMap}
        />
      )
    case "quizButton":
      return <QuizButton data={item} />
    case "videoCarousel":
      return <CarouselVideo data={item} videoMap={videoMap} />
    case "navigationCarousel":
      return <NavigationCarousel data={item} />
    case "text":
      return <Text data={item} />
    case "promoBanner":
      return <PromoBanner data={item} />
    case "infoBlocks":
      return <InfoBlocks data={item} />
    case "cta":
      return <CTASection data={item} />
    default: {
      if (process.env.NODE_ENV === "development") {
        console.warn("[Section] Unhandled content type:", item.t)
      }
      return null
    }
  }
}
