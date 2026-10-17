// A topic card shows its label in the UI language but always searches with its
// English term (U7, U10). The fixture `ru` catalog replaces the label only.
import { act } from "react"

jest.mock("expo-image", () => ({ Image: () => null }))
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

async function render(): Promise<TestInstance> {
  await act(async () => {
    renderer = TestRenderer.create(
      <TopicCard topic={parables!} onSelect={onSelect} cardWidth={160} />,
    )
  })
  return renderer!
}

beforeEach(() => {
  onSelect.mockReset()
  resetLocaleStoreForTests()
  mockGetLocales.mockReset()
  mockGetLocales.mockReturnValue(phoneLocales("en-US"))
  startLocaleSync()
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
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
})
