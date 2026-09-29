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

async function changePhoneLanguage(tag: string) {
  mockGetLocales.mockReturnValue(phoneLocales(tag))
  await act(async () => {
    refreshLocale()
  })
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
  it("shows the English label and searches its term", async () => {
    const card = await render()
    expect(hasText(card, "Parables")).toBe(true)

    act(() => pressableByLabel(card, "Search Parables").props.onPress?.())

    expect(onSelect).toHaveBeenCalledWith("parables")
  })

  it("shows the translated label and still searches the English term", async () => {
    const card = await render()
    await changePhoneLanguage("ru-RU")

    expect(hasText(card, "Притчи")).toBe(true)
    expect(hasText(card, "Parables")).toBe(false)
    act(() => pressableByLabel(card, "Искать: Притчи").props.onPress?.())

    expect(onSelect).toHaveBeenCalledWith("parables")
  })

  it("keeps one tap name in both languages", async () => {
    const card = await render()
    const english = tapActionName(pressableByLabel(card, "Search Parables"))

    await changePhoneLanguage("ru-RU")

    const russian = tapActionName(pressableByLabel(card, "Искать: Притчи"))
    expect(russian).toBe(english)
    expect(english).toBe("browse-topic")
  })
})
