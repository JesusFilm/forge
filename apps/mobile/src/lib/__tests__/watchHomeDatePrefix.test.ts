// U10: the hero's displayed date follows the UI language, while the daily
// rotation key stays `en-CA` (YYYY-MM-DD), so every language rotates the
// same videos on the same day.
import {
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../i18n/localeStore"
import { phoneLocales } from "../../test-utils/uiLocaleFixture"
import {
  buildWatchHomeHeroQueue,
  formatWatchHomeDatePrefix,
  getWatchHomeDeterministicOffset,
  mergeWatchHomeMuxInserts,
  muxSlideDisplayCopy,
  simpleHash,
  type WatchHomeMuxSlide,
} from "../watchHome/carouselSequence"
import type { WatchHomeMuxInsertConfig } from "../watchHome/config"

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
      de: {},
    }),
)
jest.mock("../../i18n/pluralData.generated", () =>
  jest
    .requireActual("../../test-utils/uiLocaleFixture")
    .withFixturePluralData(
      jest.requireActual("../../i18n/pluralData.generated"),
      ["de"],
    ),
)

// 12:00Z is 8am Eastern on 2026-06-04 (EDT); 03:00Z is 11pm Eastern the day
// before, so the displayed date and the rotation day both move back one day.
const morningNow = new Date("2026-06-04T12:00:00.000Z")
const lateNightNow = new Date("2026-06-04T03:00:00.000Z")

const welcome = {
  id: "welcome-start",
  enabled: true,
  playbackIds: ["playback-a"],
  durationSeconds: 9,
  label: "Faith & Scripture",
  title: "Today's Video Picks",
  collectionTitle: null,
  description: null,
  action: null,
  logo: true,
  posterOverride: null,
  trigger: { type: "sequence-start" },
} satisfies WatchHomeMuxInsertConfig

function firstMuxSlide(slides: readonly { kind: string }[]): WatchHomeMuxSlide {
  const slide = slides[0]
  if (slide?.kind !== "mux") throw new Error("expected the welcome mux slide")
  return slide as WatchHomeMuxSlide
}

function usePhoneLanguage(tag: string) {
  mockGetLocales.mockReturnValue(phoneLocales(tag))
  refreshLocale()
}

beforeEach(() => {
  resetLocaleStoreForTests()
  mockGetLocales.mockReset()
  mockGetLocales.mockReturnValue(phoneLocales("en-US"))
  startLocaleSync()
})
afterAll(() => resetLocaleStoreForTests())

describe("formatWatchHomeDatePrefix", () => {
  it.each([
    ["en", "Jun 4"],
    ["de", "4. Juni"],
    ["ru", "4 июн."],
    ["zh-Hans", "6月4日"],
  ])("formats with the UI tag %s", (tag, text) => {
    expect(formatWatchHomeDatePrefix(morningNow, tag)).toBe(text)
  })

  it("keeps the Eastern calendar day in every language", () => {
    expect(formatWatchHomeDatePrefix(lateNightNow, "en")).toBe("Jun 3")
    expect(formatWatchHomeDatePrefix(lateNightNow, "de")).toBe("3. Juni")
  })

  it("falls back to US English for a tag the runtime lacks or rejects", () => {
    // `crk` has no date data in the runtime; a malformed tag throws.
    expect(formatWatchHomeDatePrefix(morningNow, "crk")).toBe("Jun 4")
    expect(formatWatchHomeDatePrefix(morningNow, "not a tag!")).toBe("Jun 4")
  })
})

describe("the hero's date prefix", () => {
  it("builds the first slide's title with the UI tag", () => {
    const { slides } = buildWatchHomeHeroQueue({
      pools: [],
      inserts: [welcome],
      now: morningNow,
      uiTag: "de",
    })
    expect(firstMuxSlide(slides).title).toBe("4. Juni: Today's Video Picks")
  })

  it("re-resolves the prefix at display time with the given tag", () => {
    const slide = firstMuxSlide(
      mergeWatchHomeMuxInserts([], [welcome], morningNow, "seed", "en"),
    )
    expect(slide.title).toBe("Jun 4: Today's Video Picks")
    expect(muxSlideDisplayCopy(slide, morningNow, "de").title).toBe(
      "4. Juni: Today's Video Picks",
    )
  })

  it("reads the UI tag from the store when a caller passes none", () => {
    const slide = firstMuxSlide(
      mergeWatchHomeMuxInserts([], [welcome], morningNow),
    )
    expect(muxSlideDisplayCopy(slide, morningNow).title).toBe(
      "Jun 4: Today's Video Picks",
    )

    usePhoneLanguage("de-DE")

    expect(muxSlideDisplayCopy(slide, morningNow).title).toBe(
      "4. Juni: Today's Video Picks",
    )
  })
})

describe("the rotation key", () => {
  // A count above any hash makes the offset the hash itself, so each case
  // pins the exact key string, not one of a few buckets.
  const COUNT = 2 ** 31
  const offset = (now: Date) =>
    getWatchHomeDeterministicOffset("pool-a", COUNT, { now })

  it("stays the en-CA day in any UI language", () => {
    expect(offset(morningNow)).toBe(simpleHash("2026-06-04pool-a"))

    usePhoneLanguage("de-DE")

    expect(offset(morningNow)).toBe(simpleHash("2026-06-04pool-a"))
    // The key is the Eastern day, so 11pm Eastern is still June 3.
    expect(offset(lateNightNow)).toBe(simpleHash("2026-06-03pool-a"))
  })
})
