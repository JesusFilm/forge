// A topic card shows its label in the UI language but always searches with its
// English term (U7, U10). The fixture `ru` catalog replaces the label only.
import { act } from "react"
import { Platform } from "react-native"

// The mock logs the props of each render, so a case can read the blur that
// would reach the native view.
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
  it.each([
    ["android", undefined],
    ["ios", 12],
  ] as const)(
    "on %s, sends blurRadius %s with the thumbnail",
    async (os, blurRadius) => {
      setPlatform(os)
      const thumbnailUrl = "https://example.com/parables.jpg"
      const card = await render(thumbnailUrl)

      // Anti-vacuous: the thumbnail still renders, so the blur was not dropped
      // with the image. The label still renders over it.
      const image = mockImageProps.at(-1)
      expect(image?.source).toBe(thumbnailUrl)
      expect(image?.blurRadius).toBe(blurRadius)
      expect(hasText(card, "Parables")).toBe(true)
    },
  )
})
