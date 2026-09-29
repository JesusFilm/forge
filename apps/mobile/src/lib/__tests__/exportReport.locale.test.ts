// The report's words come from the catalog in use when it renders. The real
// en.json and catalog index join a fixture `es` catalog, so a case can change
// the UI language the way the phone does.
import {
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../i18n/localeStore"
import { getT } from "../../i18n/useT"
import { phoneLocales } from "../../test-utils/uiLocaleFixture"
import {
  foldSignal,
  viewFor,
  type ExportReportRecord,
  type ExportReportSignal,
} from "../exportReport"

const mockGetLocales = jest.fn()
jest.mock("expo-localization", () => ({
  getLocales: () => mockGetLocales(),
}))
jest.mock("expo-localization/build/ExpoLocalization", () => ({
  addLocaleListener: () => ({ remove: () => undefined }),
}))
jest.mock("../../i18n/catalogs.generated", () =>
  jest
    .requireActual("../../test-utils/uiLocaleFixture")
    .withFixtureCatalogs(jest.requireActual("../../i18n/catalogs.generated"), {
      es: {
        ExportReport: {
          seriesSaved:
            "{total, plural, one {Se guardaron {saved} de # episodio.} other {Se guardaron {saved} de # episodios.}}",
          failedCount:
            "{count, plural, one {# no se guardó.} other {# no se guardaron.}}",
          blockedCount:
            "{count, plural, one {# no empezó.} other {# no empezaron.}}",
          insufficientStorage: "No hay suficiente espacio en este dispositivo.",
        },
      },
    }),
)
jest.mock("../../i18n/pluralData.generated", () =>
  jest
    .requireActual("../../test-utils/uiLocaleFixture")
    .withFixturePluralData(
      jest.requireActual("../../i18n/pluralData.generated"),
      ["es"],
    ),
)

function useLanguage(tag: string) {
  mockGetLocales.mockReturnValue(phoneLocales(tag))
  startLocaleSync()
  refreshLocale()
}

function run(signals: readonly ExportReportSignal[]): ExportReportRecord {
  const records = signals.reduce<ExportReportRecord[]>(
    (current, signal) => foldSignal(current, signal, 0),
    [],
  )
  expect(records).toHaveLength(1)
  return records[0]
}

const RUN: ExportReportSignal[] = [
  { runId: "run", target: "e1", outcome: "saved", runSize: 5 },
  { runId: "run", target: "e2", outcome: "saved", runSize: 5 },
  {
    runId: "run",
    target: "e3",
    outcome: "blocked",
    runSize: 5,
    blockReason: "insufficient-storage",
  },
  { runId: "run", target: "e4", outcome: "failed", runSize: 5 },
]

beforeEach(() => {
  resetLocaleStoreForTests()
  mockGetLocales.mockReset()
})
afterAll(() => resetLocaleStoreForTests())

describe("the export report in another UI language", () => {
  it("formats both counts of a series run in English", () => {
    useLanguage("en-US")
    expect(viewFor(run(RUN), getT("ExportReport")).headline).toBe(
      "Saved 2 of 5 episodes.",
    )
  })

  it("formats both counts of a series run in a fixture es catalog", () => {
    useLanguage("es-ES")
    const view = viewFor(run(RUN), getT("ExportReport"))

    expect(view.headline).toBe("Se guardaron 2 de 5 episodios.")
    // The block reason travels as data, so it takes the language at render.
    expect(view.detail).toBe(
      "1 no se guardó. 1 no empezó. No hay suficiente espacio en este dispositivo.",
    )
  })
})
