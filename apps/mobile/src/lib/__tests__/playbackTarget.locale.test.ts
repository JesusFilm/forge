// The Cast labels through the real store and translator (KTD13). A fixture
// `ar` catalog joins the real set, so the label can change language.
const mockGetLocales = jest.fn()
jest.mock("expo-localization", () => ({
  getLocales: () => mockGetLocales(),
}))
jest.mock("expo-localization/build/ExpoLocalization", () => ({
  addLocaleListener: () => ({ remove: () => undefined }),
}))
jest.mock("../datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock("../../i18n/catalogs.generated", () =>
  jest
    .requireActual("../../test-utils/uiLocaleFixture")
    .withFixtureCatalogs(jest.requireActual("../../i18n/catalogs.generated"), {
      ar: {
        Cast: {
          castAriaLabel: "إرسال",
          castingToAriaLabel: "جارٍ الإرسال إلى {device}",
          connectingTo: "جارٍ الاتصال بـ {device}…",
        },
      },
    }),
)
jest.mock("../../i18n/pluralData.generated", () =>
  jest
    .requireActual("../../test-utils/uiLocaleFixture")
    .withFixturePluralData(
      jest.requireActual("../../i18n/pluralData.generated"),
      ["ar"],
    ),
)

import {
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../i18n/localeStore"
import { getT } from "../../i18n/useT"
import { phoneLocales } from "../../test-utils/uiLocaleFixture"
import { castButtonLabel, castIndicatorLabel } from "../playbackTarget"

const FSI = "⁨"
const PDI = "⁩"
const ARABIC_TV = "تلفاز غرفة المعيشة"

beforeEach(() => {
  resetLocaleStoreForTests()
  mockGetLocales.mockReset()
  mockGetLocales.mockReturnValue(phoneLocales("ar-EG"))
  startLocaleSync()
})

describe("castButtonLabel in the UI language", () => {
  it("isolates an Arabic device name in the Arabic label", () => {
    const t = getT("Cast")

    expect(castButtonLabel("idle", null, t)).toBe("إرسال")
    expect(castButtonLabel("active", ARABIC_TV, t)).toBe(
      `جارٍ الإرسال إلى ${FSI}${ARABIC_TV}${PDI}`,
    )
  })

  it("isolates a Latin device name in the Arabic label", () => {
    expect(
      castIndicatorLabel("connecting", "Living Room TV", getT("Cast")),
    ).toBe(`جارٍ الاتصال بـ ${FSI}Living Room TV${PDI}…`)
  })

  it("falls back to English for a key the Arabic catalog lacks", () => {
    expect(castIndicatorLabel("active", null, getT("Cast"))).toBe("Casting")
  })
})
