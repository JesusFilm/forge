/** U14 (KTD13) and feat-692 U4 (R15-R17, AE5): start-aligned text takes its
 *  direction from its own language and its edge from the layout. With mirroring
 *  off, an English UI renders every covered surface with no new props (R10). */
let mockUiTag = "en"
jest.mock("../../hooks/useUiTag", () => ({
  useUiTag: () => mockUiTag,
}))
const mockLayout: { rtl: boolean; mirroring: boolean } = {
  rtl: false,
  mirroring: true,
}
jest.mock("../../i18n/layoutRtl", () => ({
  isLayoutRtl: () => mockLayout.rtl,
}))
jest.mock("../../i18n/mirroredLayout", () => ({
  get MIRRORED_LAYOUT_ENABLED() {
    return mockLayout.mirroring
  },
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

// With `direction` set, textAlign "left" is the start of the text's own
// language and "right" its end (device check, feat-692 U4).
const RTL_START = {
  direction: "rtl",
  writingDirection: "rtl",
  textAlign: "left",
}
const RTL_END = {
  direction: "rtl",
  writingDirection: "rtl",
  textAlign: "right",
}
const LTR_START = {
  direction: "ltr",
  writingDirection: "ltr",
  textAlign: "left",
}
const LTR_END = {
  direction: "ltr",
  writingDirection: "ltr",
  textAlign: "right",
}
// Today's rule, with mirroring off.
const RTL = { direction: "rtl", writingDirection: "rtl", textAlign: undefined }
const LTR = { direction: "ltr", writingDirection: "ltr", textAlign: undefined }

type Expected = typeof RTL_START | typeof RTL | null

const mounted: TestInstance[] = []

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((renderer) => renderer.unmount())
  })
  mockUiTag = "en"
  mockLayout.rtl = false
  mockLayout.mirroring = true
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
    textAlign?: unknown
  }
  return {
    direction: flat.direction,
    writingDirection: flat.writingDirection,
    textAlign: flat.textAlign,
  }
}

const NO_STYLE = {
  direction: undefined,
  writingDirection: undefined,
  textAlign: undefined,
}

function expectDirection(
  renderer: TestInstance,
  needle: string,
  expected: Expected,
  language?: string,
) {
  for (const node of texts(renderer, needle)) {
    expect(directionOf(node)).toEqual(expected ?? NO_STYLE)
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

describe("an Arabic UI in a mirrored layout (AE5)", () => {
  beforeEach(() => {
    mockUiTag = "ar"
    mockLayout.rtl = true
  })

  it("renders an Arabic watch title at the start edge", () => {
    expectDirection(render(title("يسوع", "ar")), "يسوع", RTL_START)
  })

  it("covers AE5: puts a short English title at the right edge, marked English", () => {
    expectDirection(render(title("JESUS", "en")), "JESUS", LTR_END, "en")
  })

  it("covers AE5: puts an English description at the left edge", () => {
    const renderer = render(
      <VideoDescription description="Life of Jesus" descriptionLang="en" />,
    )
    expectDirection(renderer, "Life of Jesus", LTR_START, "en")
  })

  it("renders the study questions' UI heading and an English fallback list", () => {
    const renderer = render(
      <RelatedQuestionsRenderer
        section={QUESTIONS}
        headingLang="ar"
        questionsLang="en"
      />,
    )
    expectDirection(renderer, "Study questions", RTL_START)
    expectDirection(renderer, "Who is Jesus?", LTR_END, "en")
    expect(pressableLanguages(renderer, "Who is Jesus?")).toEqual(["en"])
  })

  it("puts an opened English answer at the left edge, as a paragraph", () => {
    const section = {
      ...QUESTIONS,
      questions: [{ question: "Who is Jesus?", answer: "He is the Son." }],
    } as AdminBlock
    const renderer = render(
      <RelatedQuestionsRenderer
        section={section}
        headingLang="ar"
        questionsLang="en"
      />,
    )
    const [row] = renderer.root.findAll(
      (node) =>
        node.props.accessibilityLabel === "Who is Jesus?" &&
        typeof node.props.onPress === "function",
    )
    const press = row!.props.onPress as () => void
    act(() => press())
    expectDirection(renderer, "He is the Son.", LTR_START, "en")
  })

  it("renders a Home card title with `lang: ar` at the start edge", () => {
    expectDirection(
      render(<HomeCard card={CARD} variant="landscape" />),
      "يسوع",
      RTL_START,
    )
  })

  it("renders a Home card title with `lang: en` at the right edge, marked English", () => {
    const card = { ...CARD, title: "JESUS", titleLang: "en" }
    const renderer = render(<HomeCard card={card} variant="landscape" />)
    expectDirection(renderer, "JESUS", LTR_END, "en")
    expect(pressableLanguages(renderer, "JESUS")).toEqual(["en"])
  })

  it("renders an English fallback shelf heading at the right edge, marked English", () => {
    const heading = "What Really Makes Us Happy?"
    const renderer = render(<HomeShelf section={shelf(heading, "en")} />)
    expectDirection(renderer, heading, LTR_END, "en")
  })

  it("renders the app's own shelf heading as UI text", () => {
    expectDirection(
      render(<HomeShelf section={shelf("مختارات")} />),
      "مختارات",
      RTL_START,
    )
  })

  it("renders an English fallback episode title at the right edge", () => {
    const renderer = render(
      <SeriesEpisodeCard episode={EPISODE} onSelect={() => {}} />,
    )
    expectDirection(renderer, "Episode One", LTR_END, "en")
  })

  it("renders the screen top bar title as UI text", () => {
    expectDirection(
      render(<ScreenTopBar title="الحساب" showBack />),
      "الحساب",
      RTL_START,
    )
  })

  it("renders an Arabic language name at the start edge", () => {
    const renderer = render(languageSheet([variant("arabic", "العربية", "ar")]))
    expectDirection(renderer, "العربية", RTL_START)
  })

  it("renders an English fallback language name at the right edge, marked English", () => {
    const renderer = render(languageSheet([variant("hausa", "Hausa", "en")]))
    expectDirection(renderer, "Hausa", LTR_END, "en")
    expect(pressableLanguages(renderer, "Hausa")).toEqual(["en"])
  })
})

describe("an English UI with Arabic content (AE5)", () => {
  it("covers AE5: puts a short Arabic card title at the left edge", () => {
    expectDirection(
      render(<HomeCard card={CARD} variant="landscape" />),
      "يسوع",
      RTL_END,
      "ar",
    )
  })

  it("covers AE5: puts an Arabic description at the right edge", () => {
    const renderer = render(
      <VideoDescription description="حياة يسوع" descriptionLang="ar" />,
    )
    expectDirection(renderer, "حياة يسوع", RTL_START, "ar")
  })
})

const ENGLISH_SURFACES = (
  <>
    <VideoMetadata
      label="featureFilm"
      title="JESUS"
      titleLang="en"
      subtitle={null}
    />
    <VideoDescription description="Life of Jesus" descriptionLang="en" />
    <HomeCard
      card={{ ...CARD, title: "Card", titleLang: "en" }}
      variant="landscape"
    />
    <HomeShelf
      section={{
        ...shelf("Picks", "en"),
        cards: [{ ...CARD, title: "Card", titleLang: "en" }],
      }}
    />
    <SeriesEpisodeCard episode={EPISODE} onSelect={() => {}} />
    {languageSheet([variant("english", "English", "en")])}
    <RelatedQuestionsRenderer
      section={QUESTIONS}
      headingLang="en"
      questionsLang="en"
    />
    <ScreenTopBar title="Account" showBack />
  </>
)

const ENGLISH_NEEDLES = [
  "JESUS",
  "Life of Jesus",
  "Card",
  "Picks",
  "Episode One",
  "English",
  "Who is Jesus?",
  "Account",
]

describe("an English UI", () => {
  it("puts every covered surface at the left edge, with no language mark", () => {
    const renderer = render(ENGLISH_SURFACES)
    for (const needle of ENGLISH_NEEDLES) {
      expectDirection(renderer, needle, LTR_START, undefined)
    }
  })
})

describe("mirroring off (R10)", () => {
  beforeEach(() => {
    mockLayout.mirroring = false
  })

  it("adds no direction style and no language mark to any covered surface in an English UI", () => {
    const renderer = render(ENGLISH_SURFACES)
    for (const needle of ENGLISH_NEEDLES) {
      expectDirection(renderer, needle, null, undefined)
    }
    const all = renderer.root.findAll((node) => typeof node.type === "string")
    for (const node of all) {
      expect(directionOf(node)).toEqual(NO_STYLE)
      expect(node.props.accessibilityLanguage).toBeUndefined()
    }
  })

  it("keeps today's own-language rule in an Arabic UI", () => {
    mockUiTag = "ar"
    expectDirection(render(title("يسوع", "ar")), "يسوع", RTL)
    expectDirection(render(title("JESUS", "en")), "JESUS", LTR, "en")
    const renderer = render(
      <VideoDescription description="Life of Jesus" descriptionLang="en" />,
    )
    expectDirection(renderer, "Life of Jesus", LTR, "en")
  })
})
