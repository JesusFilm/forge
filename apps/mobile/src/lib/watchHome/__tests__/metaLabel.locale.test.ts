// The card chip counts episodes with the catalog's plural forms (R7). The
// fixture `ru` catalog loads the real Russian plural data, which has three
// forms for whole numbers, so a two-form rule cannot pass.
import {
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../../i18n/localeStore"
import { getT } from "../../../i18n/useT"
import { phoneLocales } from "../../../test-utils/uiLocaleFixture"
import { buildMetaLabel } from "../model"

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
          Home: {
            episodeCount:
              "{count, plural, one {# эпизод} few {# эпизода} many {# эпизодов} other {# эпизода}}",
          },
        },
      },
    ),
)
jest.mock("../../../i18n/pluralData.generated", () => {
  const actual = jest.requireActual("../../../i18n/pluralData.generated")
  return {
    ...actual,
    PLURAL_DATA_TAG: { ...actual.PLURAL_DATA_TAG, ru: "ru" },
    PLURAL_DATA_LOADERS: {
      ...actual.PLURAL_DATA_LOADERS,
      ru: () =>
        jest.requireActual("@formatjs/intl-pluralrules/locale-data/ru.js"),
    },
  }
})

function usePhoneLanguage(tag: string) {
  mockGetLocales.mockReturnValue(phoneLocales(tag))
  refreshLocale()
}

function episodes(count: number): string | null {
  return buildMetaLabel(
    { label: "Series", durationSeconds: 90, childCount: count },
    getT("Home"),
  )
}

beforeEach(() => {
  resetLocaleStoreForTests()
  mockGetLocales.mockReset()
  mockGetLocales.mockReturnValue(phoneLocales("en-US"))
  startLocaleSync()
})
afterAll(() => resetLocaleStoreForTests())

describe("buildMetaLabel episode count", () => {
  it.each([
    ["en-US", 1, "1 episode"],
    ["en-US", 3, "3 episodes"],
    ["ru-RU", 1, "1 эпизод"],
    ["ru-RU", 3, "3 эпизода"],
    ["ru-RU", 5, "5 эпизодов"],
    ["ru-RU", 21, "21 эпизод"],
  ])("takes the %s form for %i", (tag, count, text) => {
    usePhoneLanguage(tag)
    expect(episodes(count)).toBe(text)
  })

  it("keeps the duration and the label out of the count", () => {
    usePhoneLanguage("ru-RU")
    expect(episodes(0)).toBe("1:30")
  })
})
