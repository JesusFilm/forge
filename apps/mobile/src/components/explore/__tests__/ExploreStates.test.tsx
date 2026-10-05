/**
 * Explore's non-clip states (R36, R37, R40, R47). The reducer owns the phase;
 * these views only show it. An unreachable admin reaches the reducer as the
 * `offline` event, so it must render the offline view and never the empty one.
 */

import { act, type ReactElement } from "react"

jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
// A fixture `es` catalog joins the real set, so the UI language can change
// while a state is on screen.
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
          Explore: {
            retry: "Reintentar",
            emptyTitle: "Aún no hay clips en {languageName}",
            emptyBody:
              "Elige otro idioma en la página de un video para ver más clips.",
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

import {
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../../i18n/localeStore"
import {
  phoneLocales,
  tapActionName,
} from "../../../test-utils/uiLocaleFixture"
import {
  ClipFailed,
  ExploreStates,
  type ExploreStatesProps,
} from "../ExploreStates"
import {
  INITIAL_FEED_STATE,
  canSwipeNext,
  feedReducer,
  type FeedState,
} from "../../../lib/explore/feedState"
import type { FeedClip } from "../../../lib/explore/types"
import {
  TestRenderer,
  hasText,
  pressableByLabel,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const mounted: TestInstance[] = []

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((renderer) => renderer.unmount())
  })
  jest.useRealTimers()
})

function mount(element: ReactElement): TestInstance {
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(element)
  })
  mounted.push(renderer)
  return renderer
}

function render(
  phase: ExploreStatesProps["phase"],
  onRetry = jest.fn(),
): TestInstance {
  return mount(
    <ExploreStates phase={phase} languageName="Swahili" onRetry={onRetry} />,
  )
}

const CLIP: FeedClip = {
  videoId: "video-1",
  coreId: "1_jf-0-0",
  slug: "the-birth-of-jesus",
  title: "The Birth of Jesus",
  description: null,
  imageUrl: null,
  muxPlaybackId: "mux-1",
  streamUrl: "https://stream.mux.com/mux-1.m3u8",
  feedLanguageSlug: "swahili",
  audioLanguageSlug: "swahili",
  subtitleLanguageSlug: null,
  subtitleVttSrc: null,
  subtitleOnly: false,
  window: { startSeconds: 10, endSeconds: 40 },
  cut: "sentence",
}

describe("ExploreStates", () => {
  it("shows the offline message with a retry", () => {
    const onRetry = jest.fn()
    const renderer = render("offline", onRetry)
    expect(hasText(renderer, "You're offline")).toBe(true)
    expect(hasText(renderer, "Check your connection, then try again.")).toBe(
      true,
    )
    const retry = pressableByLabel(renderer, "Try again")
    expect(retry.props.accessibilityRole).toBe("button")
    act(() => {
      retry.props.onPress?.()
    })
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("names the feed language in the empty state, with no retry", () => {
    const renderer = render("empty")
    expect(hasText(renderer, "No clips in Swahili yet")).toBe(true)
    expect(hasText(renderer, "Swahili")).toBe(true)
    expect(
      renderer.root.findAll((n) => n.props.accessibilityLabel === "Try again"),
    ).toHaveLength(0)
  })

  it("shows the offline message, not the empty state, when admin cannot be reached", () => {
    // The queue reports an unreachable admin as `offline` (R47).
    const state = feedReducer(
      feedReducer(INITIAL_FEED_STATE, { type: "focus", playerMode: "two" }),
      { type: "offline" },
    )
    const { phase } = state
    if (phase !== "offline" && phase !== "empty") {
      throw new Error(`expected a full-screen phase, got ${phase}`)
    }
    const renderer = render(phase)
    expect(hasText(renderer, "You're offline")).toBe(true)
    expect(hasText(renderer, "No clips in Swahili yet")).toBe(false)
  })

  it("shows a failed clip's message without taking the swipe or advancing", () => {
    jest.useFakeTimers()
    const renderer = mount(<ClipFailed />)
    expect(
      hasText(renderer, "This clip can't play. Swipe for the next one."),
    ).toBe(true)

    // Swipeable: nothing in the view claims a touch or offers an action.
    const [root] = renderer.root.findAll(
      (n) => n.props.testID === "clip-failed" && typeof n.type === "string",
    )
    expect(root?.props.pointerEvents).toBe("none")
    expect(
      renderer.root.findAll(
        (n) =>
          typeof n.props.onPress === "function" ||
          typeof n.props.onStartShouldSetResponder === "function",
      ),
    ).toHaveLength(0)

    // And the reducer keeps the pager's swipe for this phase.
    const failed: FeedState = {
      ...INITIAL_FEED_STATE,
      phase: "clipFailed",
      history: [CLIP],
      cursor: 0,
      queued: { ...CLIP, videoId: "video-2" },
    }
    expect(canSwipeNext(failed)).toBe(true)

    // No auto-advance: time passes and the message stays.
    act(() => {
      jest.advanceTimersByTime(60_000)
    })
    expect(
      hasText(renderer, "This clip can't play. Swipe for the next one."),
    ).toBe(true)
  })
})

// R7: the empty state reads the catalog, and the catalog names the feed
// language through a placeholder, so a translation keeps the name in place.
describe("ExploreStates in another UI language", () => {
  beforeEach(() => {
    resetLocaleStoreForTests()
    mockGetLocales.mockReset()
    mockGetLocales.mockReturnValue(phoneLocales("en-US"))
    startLocaleSync()
  })
  afterAll(() => resetLocaleStoreForTests())

  it("names the feed language through the catalog placeholder", () => {
    const renderer = render("empty")
    expect(hasText(renderer, "No clips in Swahili yet")).toBe(true)

    mockGetLocales.mockReturnValue(phoneLocales("es-ES"))
    act(() => {
      refreshLocale()
    })

    expect(hasText(renderer, "Aún no hay clips en Swahili")).toBe(true)
    expect(hasText(renderer, "No clips in Swahili yet")).toBe(false)
    expect(
      hasText(
        renderer,
        "Elige otro idioma en la página de un video para ver más clips.",
      ),
    ).toBe(true)

    act(() => {
      renderer.update(
        <ExploreStates
          phase="empty"
          languageName="Tagalog"
          onRetry={jest.fn()}
        />,
      )
    })
    expect(hasText(renderer, "Aún no hay clips en Tagalog")).toBe(true)
  })

  it("keeps the retry tap name when its label changes language", () => {
    const renderer = render("offline")
    const english = tapActionName(pressableByLabel(renderer, "Try again"))

    mockGetLocales.mockReturnValue(phoneLocales("es-ES"))
    act(() => {
      refreshLocale()
    })

    const spanish = pressableByLabel(renderer, "Reintentar")
    expect(hasText(renderer, "Reintentar")).toBe(true)
    expect(tapActionName(spanish)).toBe(english)
    expect(english).toBe("explore-retry")
  })
})
