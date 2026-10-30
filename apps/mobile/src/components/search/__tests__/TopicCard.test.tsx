// A topic card shows its label in the UI language but always searches with its
// English term (U7, U10). The fixture `ru` catalog replaces the label only.
import { act } from "react"
import { Platform, StyleSheet } from "react-native"

// The mock logs the props of each render, so a case can read the blur and the
// box that would reach the native view.
const mockImageProps: Record<string, unknown>[] = []
jest.mock("expo-image", () => ({
  Image: (props: Record<string, unknown>) => {
    mockImageProps.push(props)
    return null
  },
}))
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))

const mockGetLocales = jest.fn()
jest.mock("expo-localization", () => ({
  getLocales: () => mockGetLocales(),
}))
jest.mock("expo-localization/build/ExpoLocalization", () => ({
  addLocaleListener: () => ({ remove: () => undefined }),
}))
jest.mock("../../../i18n/catalogs.generated", () =>
  jest
    .requireActual("../../../test-utils/uiLocaleFixture")
    .withFixtureCatalogs(
      jest.requireActual("../../../i18n/catalogs.generated"),
      {
        ru: {
          BrowseTopics: {
            heading: "Категории",
            parables: "Притчи",
            searchTopicAriaLabel: "Искать: {topic}",
          },
        },
      },
    ),
)
jest.mock("../../../i18n/pluralData.generated", () =>
  jest
    .requireActual("../../../test-utils/uiLocaleFixture")
    .withFixturePluralData(
      jest.requireActual("../../../i18n/pluralData.generated"),
      ["ru"],
    ),
)

import {
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../../i18n/localeStore"
import { BROWSE_TOPICS } from "../../../lib/browseTopics"
import {
  phoneLocales,
  tapActionName,
} from "../../../test-utils/uiLocaleFixture"
import {
  TestRenderer,
  hasText,
  pressableByLabel,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { TopicCard } from "../TopicCard"

const parables = BROWSE_TOPICS.find((topic) => topic.searchTerm === "parables")
if (!parables) throw new Error("the parables topic is missing")

type Box = {
  position?: string
  top?: number
  left?: number
  width?: number
  height?: number
  opacity?: number
  transform?: { scale?: number }[]
}

let renderer: TestInstance | null = null
const onSelect = jest.fn()

async function render(thumbnailUrl?: string): Promise<TestInstance> {
  await act(async () => {
    renderer = TestRenderer.create(
      <TopicCard
        topic={parables!}
        onSelect={onSelect}
        thumbnailUrl={thumbnailUrl}
        cardWidth={160}
      />,
    )
  })
  return renderer!
}

const platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, "OS")!
function setPlatform(os: "ios" | "android") {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true })
}

beforeEach(() => {
  mockImageProps.length = 0
  onSelect.mockReset()
  resetLocaleStoreForTests()
  mockGetLocales.mockReset()
  mockGetLocales.mockReturnValue(phoneLocales("en-US"))
  startLocaleSync()
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  Object.defineProperty(Platform, "OS", platformOsDescriptor)
})
afterAll(() => resetLocaleStoreForTests())

describe("TopicCard", () => {
  it("shows its label in the UI language and always searches the English term", async () => {
    const card = await render()
    expect(hasText(card, "Parables")).toBe(true)
    const english = pressableByLabel(card, "Search Parables")
    const englishName = tapActionName(english)
    act(() => english.props.onPress?.())
    expect(onSelect).toHaveBeenLastCalledWith("parables")

    mockGetLocales.mockReturnValue(phoneLocales("ru-RU"))
    await act(async () => {
      refreshLocale()
    })

    expect(hasText(card, "Притчи")).toBe(true)
    expect(hasText(card, "Parables")).toBe(false)
    const russian = pressableByLabel(card, "Искать: Притчи")
    act(() => russian.props.onPress?.())
    expect(onSelect).toHaveBeenCalledTimes(2)
    expect(onSelect).toHaveBeenLastCalledWith("parables")
    expect(tapActionName(russian)).toBe(englishName)
    expect(englishName).toBe("browse-topic")
  })

  // feat-784: on Android, expo-image blurs with RenderScript, and the six cards
  // blur at the same time, which can crash the app. iOS keeps its blur.
  describe("the thumbnail", () => {
    const thumbnailUrl = "https://example.com/parables.jpg"
    const CARD_WIDTH = 160
    const CARD_HEIGHT = CARD_WIDTH / 1.05

    async function renderThumbnail(os: "ios" | "android") {
      setPlatform(os)
      const card = await render(thumbnailUrl)
      // Anti-vacuous: the thumbnail still renders, and the label over it.
      const image = mockImageProps.at(-1)
      expect(image?.source).toBe(thumbnailUrl)
      expect(hasText(card, "Parables")).toBe(true)
      return {
        image: image!,
        box: StyleSheet.flatten(image!.style as never) as Box,
        cardStyle: StyleSheet.flatten(
          (card.toJSON() as { props: { style: unknown } }).props.style as never,
        ) as { overflow?: string; borderRadius?: number },
      }
    }

    it("on Android, sends no blurRadius and stretches a small decode instead", async () => {
      const { image, box, cardStyle } = await renderThumbnail("android")
      expect(image.blurRadius).toBeUndefined()
      // Glide decodes at the small box size only with these two props
      // (createDownsampleStrategy in expo-image 57.0.5 ExpoImageViewWrapper.kt).
      expect(image.contentFit).toBe("cover")
      expect(image.allowDownscaling).not.toBe(false)

      // Glide decodes to the view's size, so the box sets the bitmap size.
      const scale = box.transform?.[0]?.scale ?? 1
      expect(box).toMatchObject({
        position: "absolute",
        width: expect.any(Number),
        height: expect.any(Number),
        opacity: 0.3,
      })
      expect(box.width).toBeCloseTo(CARD_WIDTH / 15)
      expect(box.height).toBeCloseTo(CARD_HEIGHT / 15)
      expect(box.left! + box.width! / 2).toBeCloseTo(CARD_WIDTH / 2)
      expect(box.top! + box.height! / 2).toBeCloseTo(CARD_HEIGHT / 2)
      // In a fit on device screenshots, 15 to 17 screen px per bitmap pixel
      // matched the old Android blur (radius 4, Glide sampling 4).
      expect(scale).toBeGreaterThanOrEqual(15)
      expect(scale).toBeLessThanOrEqual(17)
      expect(box.width! * scale).toBeGreaterThan(CARD_WIDTH)
      expect(box.height! * scale).toBeGreaterThan(CARD_HEIGHT)
      // The stretched view is larger than the card, so the card must clip it
      // to its round corners.
      expect(cardStyle.overflow).toBe("hidden")
      expect(cardStyle.borderRadius).toBeGreaterThan(0)
    })

    it("on iOS, keeps the blur and the full-card thumbnail", async () => {
      const { image, box } = await renderThumbnail("ios")
      expect(image.blurRadius).toBe(12)
      expect(box).toEqual({ ...StyleSheet.absoluteFill, opacity: 0.3 })
    })
  })
})
