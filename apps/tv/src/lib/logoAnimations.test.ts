jest.mock("./datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import {
  DEFAULT_LOADING_ANIMATION,
  DEFAULT_STARTUP_ANIMATION,
  LOGO_ANIMATIONS,
  LOADING_ANIMATIONS,
  parseLoadingAnimationId,
  parseLogoAnimationId,
} from "./logoAnimations"
import {
  DEFAULT_WATCH_PREFERENCES,
  mergeWatchPreferences,
  parseStoredPreferences,
  serializeWatchPreferences,
} from "./watchPreferences"

test("retains all ten choices and the requested defaults", () => {
  expect(LOGO_ANIMATIONS.map((item) => item.id)).toEqual([
    "01",
    "02",
    "03",
    "04",
    "05",
    "06",
    "07",
    "08",
    "09",
    "10",
  ])
  expect(DEFAULT_STARTUP_ANIMATION).toBe("09")
  expect(DEFAULT_LOADING_ANIMATION).toBe("03")
})

test("dots is the last loading alternative and is not a startup choice", () => {
  expect(LOADING_ANIMATIONS.map((item) => item.id)).toEqual([
    ...LOGO_ANIMATIONS.map((item) => item.id),
    "dots",
  ])
  expect(parseLogoAnimationId("dots", "09")).toBe("09")
  expect(parseLoadingAnimationId("dots", "03")).toBe("dots")
})

test("dots persists independently without changing startup or player choices", () => {
  const prefs = {
    ...DEFAULT_WATCH_PREFERENCES,
    startupAnimationId: "02" as const,
    loadingAnimationId: "dots" as const,
    nativePlayerVariant: "native-b" as const,
  }
  expect(parseStoredPreferences(serializeWatchPreferences(prefs))).toEqual(
    prefs,
  )
  expect(mergeWatchPreferences(prefs, { loadingAnimationId: "03" })).toEqual({
    ...prefs,
    loadingAnimationId: "03",
  })
})

test.each(LOGO_ANIMATIONS)(
  "validates and round-trips $id for either use",
  ({ id }) => {
    expect(parseLogoAnimationId(id, "09")).toBe(id)
    expect(parseLoadingAnimationId(id, "03")).toBe(id)
    const prefs = {
      ...DEFAULT_WATCH_PREFERENCES,
      startupAnimationId: id,
      loadingAnimationId: id,
    }
    expect(parseStoredPreferences(serializeWatchPreferences(prefs))).toEqual(
      prefs,
    )
  },
)

test("older preferences keep their schema and resolve animation defaults separately", () => {
  const prefs = parseStoredPreferences('{"audioLanguageSlug":"thai"}')
  expect(prefs.startupAnimationId ?? DEFAULT_STARTUP_ANIMATION).toBe("09")
  expect(prefs.loadingAnimationId ?? DEFAULT_LOADING_ANIMATION).toBe("03")
  expect(prefs.audioLanguageSlug).toBe("thai")
})

test("invalid stored choices use the correct independent default", () => {
  const prefs = parseStoredPreferences(
    '{"startupAnimationId":5,"loadingAnimationId":"99"}',
  )
  expect(prefs.startupAnimationId).toBe("09")
  expect(prefs.loadingAnimationId).toBe("03")
})

test("a pre-hydration selection cannot reset the other choice or player preferences", () => {
  const disk = {
    ...DEFAULT_WATCH_PREFERENCES,
    startupAnimationId: "02" as const,
    loadingAnimationId: "04" as const,
    nativePlayerVariant: "native-b" as const,
  }
  const merged = mergeWatchPreferences(disk, { loadingAnimationId: "03" })
  expect(merged).toEqual({ ...disk, loadingAnimationId: "03" })
})
