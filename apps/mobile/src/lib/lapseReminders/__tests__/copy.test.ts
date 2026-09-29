// The real en.json and catalog index, plus a fixture `es` catalog, so a case
// can change the UI language the way the phone does.
import {
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../../i18n/localeStore"
import { phoneLocales } from "../../../test-utils/uiLocaleFixture"
import { LAPSE_REMINDER_KINDS } from "../constants"
import { lapseReminderBody, lapseReminderChannelName } from "../copy"

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
        es: {
          LapseReminder: {
            day1Body: "Continúa donde lo dejaste.",
            day7Body: "Tu video te espera cuando quieras.",
            day1TitledBody: "Sigue viendo {title}.",
            day7TitledBody: "{title} te espera cuando quieras.",
            channelName: "Recordatorios",
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
      ["es"],
    ),
)

const FSI = "⁨"
const PDI = "⁩"

function useLanguage(tag: string) {
  mockGetLocales.mockReturnValue(phoneLocales(tag))
  startLocaleSync()
  refreshLocale()
}

beforeEach(() => {
  resetLocaleStoreForTests()
  mockGetLocales.mockReset()
})

describe("lapseReminderBody in English", () => {
  it("names the video when the record carries a title", () => {
    expect(lapseReminderBody("day1", "The Birth of Jesus")).toBe(
      "Continue watching The Birth of Jesus.",
    )
    expect(lapseReminderBody("day7", "The Birth of Jesus")).toBe(
      "The Birth of Jesus is still here whenever you are ready.",
    )
  })

  it("falls back to the untitled copy for a record written before titles", () => {
    expect(lapseReminderBody("day1", null)).toBe("Pick up where you left off.")
    expect(lapseReminderBody("day7", null)).toBe(
      "Your video is still here whenever you are ready.",
    )
  })

  it("treats a blank or whitespace title as no title", () => {
    expect(lapseReminderBody("day1", "")).toBe("Pick up where you left off.")
    expect(lapseReminderBody("day1", "   ")).toBe("Pick up where you left off.")
  })

  it("leaves no placeholder in any body", () => {
    for (const kind of LAPSE_REMINDER_KINDS) {
      expect(lapseReminderBody(kind, "A Title")).not.toMatch(/[{}]/)
      expect(lapseReminderBody(kind, null)).not.toMatch(/[{}]/)
    }
  })

  it("puts the title in every titled body", () => {
    // Anti-vacuous: a titled message that lost {title} would pass the case
    // above while the title never appears.
    for (const kind of LAPSE_REMINDER_KINDS) {
      expect(lapseReminderBody(kind, "A Title")).toContain("A Title")
    }
  })

  it("does not let a title that looks like a placeholder expand", () => {
    expect(lapseReminderBody("day1", "{title}")).toBe(
      "Continue watching {title}.",
    )
  })

  it("names the channel", () => {
    expect(lapseReminderChannelName()).toBe("Reminders")
  })
})

describe("lapseReminderBody in another UI language", () => {
  it("builds the body from the catalog in use when it runs", () => {
    useLanguage("es-MX")

    expect(lapseReminderBody("day1", null)).toBe("Continúa donde lo dejaste.")
    expect(lapseReminderBody("day7", "Jesús", "es")).toBe(
      "Jesús te espera cuando quieras.",
    )
    expect(lapseReminderChannelName()).toBe("Recordatorios")
  })

  it("isolates a right-to-left title with FSI and PDI", () => {
    useLanguage("es-MX")

    expect(lapseReminderBody("day1", "يسوع", "es")).toBe(
      `Sigue viendo ${FSI}يسوع${PDI}.`,
    )
  })

  it("uses the untitled copy for a title written in another language", () => {
    useLanguage("es-MX")

    expect(lapseReminderBody("day1", "The Birth of Jesus", "en")).toBe(
      "Continúa donde lo dejaste.",
    )
  })

  it("reads a record with no title language as English", () => {
    useLanguage("es-MX")

    expect(lapseReminderBody("day7", "The Birth of Jesus")).toBe(
      "Tu video te espera cuando quieras.",
    )
  })

  it("names the video again when the UI returns to the title's language", () => {
    useLanguage("es-MX")
    expect(lapseReminderBody("day1", "The Birth of Jesus", "en")).toBe(
      "Continúa donde lo dejaste.",
    )

    mockGetLocales.mockReturnValue(phoneLocales("en-US"))
    refreshLocale()

    expect(lapseReminderBody("day1", "The Birth of Jesus", "en")).toBe(
      "Continue watching The Birth of Jesus.",
    )
  })
})
