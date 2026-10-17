// The phone's languages reach the resolver through the real locale store. `ru`
// is a fixture catalog, so a phone change moves the epoch.
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
      ru: {},
    }),
)
jest.mock("../../i18n/pluralData.generated", () =>
  jest
    .requireActual("../../test-utils/uiLocaleFixture")
    .withFixturePluralData(
      jest.requireActual("../../i18n/pluralData.generated"),
      ["ru"],
    ),
)

import {
  getCatalogTag,
  getLocaleEpoch,
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../i18n/localeStore"
import { phoneLocales } from "../../test-utils/uiLocaleFixture"
import {
  INITIAL_RECONCILER_STATE,
  markUserChoice,
  reconcileDefault,
  resetReconciler,
  type ReconcileInput,
} from "../preferenceReconciler"

// KTD12, KTD16, AE11: the reconciler resolves once per video, so a language
// change never moves the audio of the video that plays.
describe("the phone-language default across a UI language change", () => {
  const DUBS = [
    { slug: "v-en", bcp47: "en", languageSlug: "english" },
    { slug: "v-ru", bcp47: "ru", languageSlug: "russian" },
  ]
  const noPick = (identity: string): ReconcileInput => ({
    ready: true,
    identity,
    options: DUBS,
    primaryBcp47: "en",
    preferredSlug: null,
  })

  afterEach(() => resetLocaleStoreForTests())

  it("keeps a playing video's audio, and the next video takes the new default", () => {
    mockGetLocales.mockReturnValue(phoneLocales("en-US"))
    startLocaleSync()
    const playing = reconcileDefault(
      INITIAL_RECONCILER_STATE,
      noPick("video-1"),
    )
    expect(playing.apply).toEqual({ slug: "v-en" })

    mockGetLocales.mockReturnValue(phoneLocales("ru-RU"))
    refreshLocale()
    expect(getCatalogTag()).toBe("ru")
    expect(getLocaleEpoch()).toBe(1)

    // The provider's effect runs again for the same video: no new default.
    const again = reconcileDefault(playing.nextState, noPick("video-1"))
    expect(again.apply).toBeUndefined()

    const next = reconcileDefault(again.nextState, noPick("video-2"))
    expect(next.apply).toEqual({ slug: "v-ru" })
  })
})

/**
 * Pure-function tests for the guard choreography the twin session providers share.
 * Every case sets a preferredSlug matching an option, so the applied slug is
 * deterministic and assertions focus on WHETHER resolution runs, not its ranking.
 */

const OPTIONS = [
  { slug: "v-en", bcp47: "en", languageSlug: "english" },
  { slug: "v-fr", bcp47: "fr", languageSlug: "french" },
]

function input(overrides: Partial<ReconcileInput> = {}): ReconcileInput {
  return {
    ready: true,
    identity: "video-1",
    options: OPTIONS,
    primaryBcp47: "en",
    preferredSlug: "french",
    ...overrides,
  }
}

describe("reconcileDefault", () => {
  it("applies the resolved default once per identity", () => {
    const first = reconcileDefault(INITIAL_RECONCILER_STATE, input())
    expect(first.apply).toEqual({ slug: "v-fr" })
    expect(first.nextState.resolvedFor).toBe("video-1")

    // Same identity again → guard blocks a second apply (partial→full republish).
    const second = reconcileDefault(first.nextState, input())
    expect(second.apply).toBeUndefined()
    expect(second.nextState).toBe(first.nextState)
  })

  it("does not resolve until preferences are ready, then resolves once ready", () => {
    const gated = reconcileDefault(
      INITIAL_RECONCILER_STATE,
      input({ ready: false }),
    )
    expect(gated.apply).toBeUndefined()
    // resolvedFor must stay null so it isn't wrongly consumed while gated.
    expect(gated.nextState.resolvedFor).toBeNull()

    const ready = reconcileDefault(gated.nextState, input({ ready: true }))
    expect(ready.apply).toEqual({ slug: "v-fr" })
  })

  it("never resolves with an empty option list", () => {
    const result = reconcileDefault(
      INITIAL_RECONCILER_STATE,
      input({ options: [] }),
    )
    expect(result.apply).toBeUndefined()
    expect(result.nextState.resolvedFor).toBeNull()
  })

  it("blocks re-resolution after an explicit user choice", () => {
    const chose = markUserChoice(INITIAL_RECONCILER_STATE)
    const result = reconcileDefault(chose, input())
    expect(result.apply).toBeUndefined()
    // The guard also prevents advancing resolvedFor, so intent survives.
    expect(result.nextState.resolvedFor).toBeNull()
  })

  it("resolves again after a reset even if the user had chosen", () => {
    const chose = markUserChoice(INITIAL_RECONCILER_STATE)
    expect(reconcileDefault(chose, input()).apply).toBeUndefined()

    const afterReset = resetReconciler()
    const result = reconcileDefault(afterReset, input())
    expect(result.apply).toEqual({ slug: "v-fr" })
    expect(result.nextState.userChose).toBe(false)
  })

  it("re-resolves for a new identity without a reset", () => {
    const first = reconcileDefault(INITIAL_RECONCILER_STATE, input())
    const next = reconcileDefault(
      first.nextState,
      input({ identity: "video-2" }),
    )
    expect(next.apply).toEqual({ slug: "v-fr" })
    expect(next.nextState.resolvedFor).toBe("video-2")
  })

  it("advances resolvedFor via the first-option fallback when nothing else matches", () => {
    // Null bcp47 defeats the locale/primary/English chain, so resolveDefaultSlug
    // returns the first option — resolution still ran, so resolvedFor advances.
    const options = [{ slug: "v-x", bcp47: null, languageSlug: "x" }]
    const result = reconcileDefault(
      INITIAL_RECONCILER_STATE,
      input({ options, preferredSlug: null, primaryBcp47: null }),
    )
    expect(result.apply).toEqual({ slug: "v-x" })
    expect(result.nextState.resolvedFor).toBe("video-1")
  })

  it("keeps concerns independent — two states track separately", () => {
    // Mirrors audio vs subtitle in WatchSessionProvider: one concern resolving or
    // being chosen must not leak into the other's guard.
    const audio = reconcileDefault(INITIAL_RECONCILER_STATE, input()).nextState
    const subtitleChose = markUserChoice(INITIAL_RECONCILER_STATE)

    expect(audio.resolvedFor).toBe("video-1")
    expect(audio.userChose).toBe(false)
    expect(subtitleChose.resolvedFor).toBeNull()
    expect(subtitleChose.userChose).toBe(true)
  })
})

describe("markUserChoice / resetReconciler", () => {
  it("markUserChoice sets the guard without touching resolvedFor", () => {
    const state = { resolvedFor: "video-1", userChose: false }
    expect(markUserChoice(state)).toEqual({
      resolvedFor: "video-1",
      userChose: true,
    })
  })

  it("resetReconciler returns a fresh initial state, not a shared reference", () => {
    const a = resetReconciler()
    const b = resetReconciler()
    expect(a).toEqual(INITIAL_RECONCILER_STATE)
    expect(a).not.toBe(INITIAL_RECONCILER_STATE)
    expect(a).not.toBe(b)
  })
})
