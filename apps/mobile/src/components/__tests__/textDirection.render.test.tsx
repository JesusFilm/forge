/** U14 (KTD13, AE5, R10): left-aligned text takes its direction from its own
 *  language. An English UI renders every covered surface with no new props. */
let mockUiTag = "en"
jest.mock("../../hooks/useUiTag", () => ({
  useUiTag: () => mockUiTag,
}))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("expo-image", () => ({ __esModule: true, Image: () => null }))
jest.mock("expo-linear-gradient", () => ({
  __esModule: true,
  LinearGradient: () => null,
}))
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: jest.fn(),
    navigate: jest.fn(),
    replace: jest.fn(),
  }),
  useNavigation: () => ({ addListener: () => () => {} }),
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
jest.mock("../watch/WatchProgressBar", () => ({
  WatchProgressBar: () => null,
  progressAccessibilityText: () => null,
}))
jest.mock("../../hooks/useWatchProgressEntry", () => ({
  useWatchProgressEntry: () => null,
}))
jest.mock("../../hooks/useHeroStream", () => ({
  prefetchHeroStream: jest.fn(),
}))
jest.mock("../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
// FlashList measures a layout jest never gives it, so rows render inline.
jest.mock("@shopify/flash-list", () => {
  const react = jest.requireActual("react") as {
    Fragment: unknown
    createElement: (type: unknown, props: unknown, ...c: unknown[]) => unknown
  }
  return {
    FlashList: (props: {
      data: unknown[]
      renderItem: (args: { item: unknown; index: number }) => unknown
      ListHeaderComponent?: unknown
    }) =>
      react.createElement(
        react.Fragment,
        null,
        props.ListHeaderComponent,
        props.data.map((item, index) =>
          react.createElement(
            react.Fragment,
            { key: index },
            props.renderItem({ item, index }),
          ),
        ),
      ),
  }
})

import { act, type ReactElement } from "react"
import { StyleSheet } from "react-native"

import { HomeCard } from "../home/HomeCard"
import { HomeShelf } from "../home/HomeShelf"
import { RelatedQuestionsRenderer } from "../sections/RelatedQuestionsRenderer"
import { SeriesEpisodeCard } from "../series/SeriesEpisodeCard"
import { LanguageSheetContent } from "../watch/LanguageSheet"
import { VideoDescription } from "../watch/VideoDescription"
import { VideoMetadata } from "../watch/VideoMetadata"
import { ScreenTopBar } from "../ui/ScreenTopBar"
import type { WatchVariant } from "../../lib/normalizeVideo"
import type { AdminBlock } from "../../lib/queries"
import type { WatchHomeCard, WatchHomeSection } from "../../lib/watchHome/model"
import {
  TestRenderer,
  type RenderedNode,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

const RTL = { direction: "rtl", writingDirection: "rtl" }
const LTR = { direction: "ltr", writingDirection: "ltr" }

const mounted: TestInstance[] = []

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((renderer) => renderer.unmount())
  })
  mockUiTag = "en"
})

function render(element: ReactElement): TestInstance {
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(element)
  })
  mounted.push(renderer)
  return renderer
}

/** Every host text node that shows `needle`. */
function texts(renderer: TestInstance, needle: string): RenderedNode[] {
  const found = renderer.root.findAll(
    (node) => typeof node.type === "string" && node.props.children === needle,
  )
  expect(found.length).toBeGreaterThan(0)
  return found
}

function directionOf(node: RenderedNode) {
  const flat = (StyleSheet.flatten(node.props.style as never) ?? {}) as {
    direction?: unknown
    writingDirection?: unknown
  }
  return { direction: flat.direction, writingDirection: flat.writingDirection }
}

function expectDirection(
  renderer: TestInstance,
  needle: string,
  expected: typeof RTL | typeof LTR | null,
  language?: string,
) {
  for (const node of texts(renderer, needle)) {
    expect(directionOf(node)).toEqual(
      expected ?? { direction: undefined, writingDirection: undefined },
    )
    // A hidden measuring copy is never read, so it carries no language mark.
    if (typeof node.props.onTextLayout !== "function") {
      expect(node.props.accessibilityLanguage).toBe(language)
    }
  }
}

/** The language mark on the pressable element a screen reader reads. */
function pressableLanguages(renderer: TestInstance, label: string): unknown[] {
  const found = renderer.root.findAll(
    (node) =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === "function",
  )
  expect(found.length).toBeGreaterThan(0)
  return [...new Set(found.map((node) => node.props.accessibilityLanguage))]
}

const CARD = {
  id: "c1-0",
  videoId: "v1",
  slug: "jesus",
  title: "يسوع",
  titleLang: "ar",
  imageUrl: null,
  imageAlt: "",
  playbackId: null,
  rawLabel: null,
  childCount: 0,
  metaLabel: null,
} as unknown as WatchHomeCard

const EPISODE = {
  documentId: "e1",
  slug: "e1",
  label: null,
  title: "Episode One",
  titleLang: "en",
  posterUrl: null,
}

function variant(slug: string, name: string, lang: string): WatchVariant {
  return {
    documentId: `doc-${slug}`,
    slug,
    published: true,
    hls: `https://example.org/${slug}.m3u8`,
    duration: null,
    languageCoreId: null,
    languageBcp47: null,
    languageSlug: slug,
    languageName: name,
    languageNameLang: lang,
    languageNameNative: null,
    languageIso3: null,
    muxPlaybackId: null,
  }
}

const QUESTIONS = {
  __typename: "RelatedQuestionsBlock",
  heading: "Study questions",
  questions: [{ question: "Who is Jesus?", answer: "" }],
  ctaLabel: null,
  ctaLink: null,
} as AdminBlock

function languageSheet(variants: WatchVariant[]) {
  return (
    <LanguageSheetContent
      variants={variants}
      activeVariantSlug="none"
      downloadedDubDocumentId={null}
      onLanguageChange={() => {}}
      onClose={() => {}}
    />
  )
}

function shelf(title: string, titleLang?: string): WatchHomeSection {
  return {
    id: "s1",
    eyebrow: "",
    title,
    titleLang,
    description: null,
    layout: "rail",
    orientation: "horizontal",
    showSequenceNumbers: false,
    cards: [CARD],
  }
}

function title(text: string, lang: string) {
  return (
    <VideoMetadata label={null} title={text} titleLang={lang} subtitle={null} />
  )
}

describe("an Arabic UI (AE5)", () => {
  beforeEach(() => {
    mockUiTag = "ar"
  })

  it("renders an Arabic watch title right to left", () => {
    expectDirection(render(title("يسوع", "ar")), "يسوع", RTL)
  })

  it("renders an English fallback watch title left to right, marked English", () => {
    expectDirection(render(title("JESUS", "en")), "JESUS", LTR, "en")
  })

  it("renders the description in its own language", () => {
    const renderer = render(
      <VideoDescription description="Life of Jesus" descriptionLang="en" />,
    )
    expectDirection(renderer, "Life of Jesus", LTR, "en")
  })

  it("renders the study questions' UI heading and an English fallback list", () => {
    const renderer = render(
      <RelatedQuestionsRenderer
        section={QUESTIONS}
        headingLang="ar"
        questionsLang="en"
      />,
    )
    expectDirection(renderer, "Study questions", RTL)
    expectDirection(renderer, "Who is Jesus?", LTR, "en")
    expect(pressableLanguages(renderer, "Who is Jesus?")).toEqual(["en"])
  })

  it("renders a Home card title with `lang: ar` right to left", () => {
    expectDirection(
      render(<HomeCard card={CARD} variant="landscape" />),
      "يسوع",
      RTL,
    )
  })

  it("renders a Home card title with `lang: en` left to right, marked English", () => {
    const card = { ...CARD, title: "JESUS", titleLang: "en" }
    const renderer = render(<HomeCard card={card} variant="landscape" />)
    expectDirection(renderer, "JESUS", LTR, "en")
    expect(pressableLanguages(renderer, "JESUS")).toEqual(["en"])
  })

  it("renders an English fallback shelf heading left to right, marked English", () => {
    const heading = "What Really Makes Us Happy?"
    const renderer = render(<HomeShelf section={shelf(heading, "en")} />)
    expectDirection(renderer, heading, LTR, "en")
  })

  it("renders the app's own shelf heading as UI text", () => {
    expectDirection(
      render(<HomeShelf section={shelf("مختارات")} />),
      "مختارات",
      RTL,
    )
  })

  it("renders an English fallback episode title left to right", () => {
    const renderer = render(
      <SeriesEpisodeCard episode={EPISODE} onSelect={() => {}} />,
    )
    expectDirection(renderer, "Episode One", LTR, "en")
  })

  it("renders the screen top bar title as UI text", () => {
    expectDirection(
      render(<ScreenTopBar title="الحساب" showBack />),
      "الحساب",
      RTL,
    )
  })

  it("renders an Arabic language name right to left", () => {
    const renderer = render(languageSheet([variant("arabic", "العربية", "ar")]))
    expectDirection(renderer, "العربية", RTL)
  })

  it("renders an English fallback language name left to right, marked English", () => {
    const renderer = render(languageSheet([variant("hausa", "Hausa", "en")]))
    expectDirection(renderer, "Hausa", LTR, "en")
    expect(pressableLanguages(renderer, "Hausa")).toEqual(["en"])
  })
})

describe("an English UI", () => {
  it("adds no direction style and no language mark to any covered surface", () => {
    const card = { ...CARD, title: "Card", titleLang: "en" }
    const renderer = render(
      <>
        <VideoMetadata
          label="featureFilm"
          title="JESUS"
          titleLang="en"
          subtitle={null}
        />
        <VideoDescription description="Life of Jesus" descriptionLang="en" />
        <HomeCard card={card} variant="landscape" />
        <HomeShelf section={{ ...shelf("Picks", "en"), cards: [card] }} />
        <SeriesEpisodeCard episode={EPISODE} onSelect={() => {}} />
        {languageSheet([variant("english", "English", "en")])}
        <RelatedQuestionsRenderer
          section={QUESTIONS}
          headingLang="en"
          questionsLang="en"
        />
        <ScreenTopBar title="Account" showBack />
      </>,
    )
    for (const needle of [
      "JESUS",
      "Life of Jesus",
      "Card",
      "Picks",
      "Episode One",
      "English",
      "Who is Jesus?",
      "Account",
    ]) {
      expectDirection(renderer, needle, null, undefined)
    }
    const all = renderer.root.findAll((node) => typeof node.type === "string")
    for (const node of all) {
      expect(directionOf(node)).toEqual({
        direction: undefined,
        writingDirection: undefined,
      })
      expect(node.props.accessibilityLanguage).toBeUndefined()
    }
  })
})
