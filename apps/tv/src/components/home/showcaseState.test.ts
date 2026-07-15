import type {
  WatchHomeCard,
  WatchHomeModel,
  WatchHomeSection,
} from "../../lib/watchHome/model"
import {
  INITIAL_SHOWCASE_STATE,
  SHOWCASE_FOCUS_DEBOUNCE_MS,
  createShowcaseFocusDebouncer,
  initialShowcaseCard,
  showcaseReducer,
  type ShowcaseState,
} from "./showcaseState"

function card(
  id: string,
  overrides: Partial<WatchHomeCard> = {},
): WatchHomeCard {
  return {
    id,
    sourceId: `source-${id}`,
    coreId: `core-${id}`,
    slug: `${id}-slug`,
    title: `Title ${id}`,
    description: null,
    label: "Feature film",
    rawLabel: "FEATURE_FILM",
    metaLabel: null,
    imageUrl: null,
    imageAlt: `Title ${id}`,
    muxPlaybackId: null,
    durationSeconds: null,
    childCount: 0,
    parentCoreId: null,
    parentSlug: null,
    missingData: [],
    ...overrides,
  }
}

function section(
  id: string,
  cards: WatchHomeCard[],
  overrides: Partial<WatchHomeSection> = {},
): WatchHomeSection {
  return {
    id,
    eyebrow: `Eyebrow ${id}`,
    title: `Section ${id}`,
    description: null,
    layout: "rail",
    orientation: "horizontal",
    showSequenceNumbers: false,
    isPosterRail: false,
    cards,
    ...overrides,
  }
}

function model(
  featured: WatchHomeCard[],
  sections: WatchHomeSection[] = [],
): WatchHomeModel {
  return { featured, sections, missingData: [] }
}

describe("initialShowcaseCard", () => {
  it("picks the first featured card", () => {
    const m = model(
      [card("hero-1"), card("hero-2")],
      [section("s1", [card("c1")])],
    )
    expect(initialShowcaseCard(m)?.id).toBe("hero-1")
  })

  // AE7: every hero coreId failed to resolve but sections resolved.
  it("falls back to the first card of the first non-empty section", () => {
    const m = model([], [section("s1", [card("c1"), card("c2")])])
    expect(initialShowcaseCard(m)?.id).toBe("c1")
  })

  // Defensive: the model drops empty sections, but if one slipped through the
  // pick must skip it rather than land on undefined.
  it("skips an empty section when picking the fallback", () => {
    const m = model([], [section("empty", []), section("s2", [card("c9")])])
    expect(initialShowcaseCard(m)?.id).toBe("c9")
  })

  it("returns null when nothing resolved", () => {
    expect(initialShowcaseCard(model([], []))).toBeNull()
    expect(initialShowcaseCard(model([], [section("empty", [])]))).toBeNull()
  })
})

describe("showcaseReducer", () => {
  it("modelResolved seeds the initial card from featured", () => {
    const m = model([card("hero-1")])
    const next = showcaseReducer(INITIAL_SHOWCASE_STATE, {
      type: "modelResolved",
      model: m,
    })
    expect(next.current?.id).toBe("hero-1")
  })

  it("modelResolved with nothing resolved yields null", () => {
    const next = showcaseReducer(INITIAL_SHOWCASE_STATE, {
      type: "modelResolved",
      model: model([], []),
    })
    expect(next.current).toBeNull()
  })

  it("cardFocused commits the focused card", () => {
    const focused = card("c3")
    const state: ShowcaseState = { current: card("hero-1") }
    const next = showcaseReducer(state, { type: "cardFocused", card: focused })
    expect(next.current).toBe(focused)
  })

  it("cardFocused with the already-shown card returns the same reference", () => {
    const shown = card("c3")
    const state: ShowcaseState = { current: shown }
    expect(showcaseReducer(state, { type: "cardFocused", card: shown })).toBe(
      state,
    )
  })

  // AE4: focus card B, then focus the chip — still B, and no re-render.
  it("nonCardFocused retains the current card (same reference)", () => {
    const state: ShowcaseState = { current: card("c3") }
    const next = showcaseReducer(state, { type: "nonCardFocused" })
    expect(next).toBe(state)
    expect(next.current?.id).toBe("c3")
  })

  it("modelRefreshed keeps the current pick when its id survives, adopting the refreshed instance", () => {
    const state: ShowcaseState = { current: card("c3", { title: "Old title" }) }
    const refreshed = card("c3", { title: "New title" })
    const next = showcaseReducer(state, {
      type: "modelRefreshed",
      model: model([card("hero-1")], [section("s1", [refreshed])]),
    })
    expect(next.current).toBe(refreshed)
    expect(next.current?.title).toBe("New title")
  })

  it("modelRefreshed re-derives the initial card when the current id is gone", () => {
    const state: ShowcaseState = { current: card("gone") }
    const next = showcaseReducer(state, {
      type: "modelRefreshed",
      model: model([card("hero-1")]),
    })
    expect(next.current?.id).toBe("hero-1")
  })

  it("modelRefreshed with no current seeds the initial card", () => {
    const next = showcaseReducer(INITIAL_SHOWCASE_STATE, {
      type: "modelRefreshed",
      model: model([card("hero-1")]),
    })
    expect(next.current?.id).toBe("hero-1")
  })
})

describe("createShowcaseFocusDebouncer", () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it("rapid focus A→B→C commits once, with C", () => {
    const commit = jest.fn()
    const debouncer = createShowcaseFocusDebouncer(commit)

    debouncer.focus(card("a"))
    jest.advanceTimersByTime(SHOWCASE_FOCUS_DEBOUNCE_MS - 1)
    debouncer.focus(card("b"))
    jest.advanceTimersByTime(SHOWCASE_FOCUS_DEBOUNCE_MS - 1)
    const last = card("c")
    debouncer.focus(last)
    jest.advanceTimersByTime(SHOWCASE_FOCUS_DEBOUNCE_MS)

    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith(last)
  })

  it("commits a settled focus after the window closes", () => {
    const commit = jest.fn()
    const debouncer = createShowcaseFocusDebouncer(commit)
    const settled = card("a")

    debouncer.focus(settled)
    expect(commit).not.toHaveBeenCalled()
    jest.advanceTimersByTime(SHOWCASE_FOCUS_DEBOUNCE_MS)
    expect(commit).toHaveBeenCalledWith(settled)
  })

  it("cancel clears the pending commit", () => {
    const commit = jest.fn()
    const debouncer = createShowcaseFocusDebouncer(commit)

    debouncer.focus(card("a"))
    debouncer.cancel()
    jest.advanceTimersByTime(SHOWCASE_FOCUS_DEBOUNCE_MS * 2)

    expect(commit).not.toHaveBeenCalled()
  })
})
