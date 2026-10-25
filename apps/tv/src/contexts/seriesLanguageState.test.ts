import {
  EMPTY_SERIES_LANGUAGE_STATE,
  buildLanguageRows,
  carriedSlug,
  clearSeries,
  resolveTrailerSwap,
  setActive,
  setSelection,
  type SeriesLanguageState,
} from "./seriesLanguageState"

// ── Selection state (per-series keying + active lineage) ───────────

describe("series language state", () => {
  it("carries the active series' selection, and null before any selection", () => {
    let state: SeriesLanguageState = EMPTY_SERIES_LANGUAGE_STATE
    expect(carriedSlug(state)).toBeNull()

    state = setActive(state, "series-a")
    expect(carriedSlug(state)).toBeNull()

    state = setSelection(state, "series-a", "french")
    expect(carriedSlug(state)).toBe("french")
  })

  it("survives nested series stacking: B never clobbers A, and pop restores A", () => {
    // Series A: select French, then push nested series B.
    let state = setActive(EMPTY_SERIES_LANGUAGE_STATE, "series-a")
    state = setSelection(state, "series-a", "french")
    state = setActive(state, "series-b")

    // B is now the lineage owner with no selection — carried is null, NOT A's.
    expect(carriedSlug(state)).toBeNull()

    state = setSelection(state, "series-b", "korean")
    expect(carriedSlug(state)).toBe("korean")
    expect(state.selections.get("series-a")).toBe("french")

    // Pop B: unmount cleanup deletes B's entry, A's focus effect re-registers.
    state = clearSeries(state, "series-b")
    state = setActive(state, "series-a")
    expect(state.selections.has("series-b")).toBe(false)
    expect(carriedSlug(state)).toBe("french")
  })

  it("converges when A refocuses BEFORE B's unmount cleanup runs", () => {
    // Focus-effect vs unmount-cleanup order is not guaranteed on pop; the
    // reverse order must also land on A active with A's selection intact.
    let state = setActive(EMPTY_SERIES_LANGUAGE_STATE, "series-a")
    state = setSelection(state, "series-a", "french")
    state = setActive(state, "series-b")
    state = setSelection(state, "series-b", "korean")

    state = setActive(state, "series-a") // A refocuses first…
    state = clearSeries(state, "series-b") // …then B's cleanup fires.

    expect(state.activeSeriesId).toBe("series-a")
    expect(carriedSlug(state)).toBe("french")
  })

  it("clearSeries deletes only its own entry", () => {
    let state = setSelection(EMPTY_SERIES_LANGUAGE_STATE, "series-a", "french")
    state = setSelection(state, "series-b", "korean")

    state = clearSeries(state, "series-b")
    expect(state.selections.has("series-b")).toBe(false)
    expect(state.selections.get("series-a")).toBe("french")
  })

  it("clearSeries releases active only when the cleared series holds it", () => {
    let state = setActive(EMPTY_SERIES_LANGUAGE_STATE, "series-a")
    state = clearSeries(state, "series-b")
    expect(state.activeSeriesId).toBe("series-a")

    state = clearSeries(state, "series-a")
    expect(state.activeSeriesId).toBeNull()
  })

  it("carries null when nothing is active, even with selections held", () => {
    let state = setSelection(EMPTY_SERIES_LANGUAGE_STATE, "series-a", "french")
    expect(carriedSlug(state)).toBeNull()

    // Active series with no selection of its own also carries null.
    state = setActive(state, "series-b")
    expect(carriedSlug(state)).toBeNull()
  })

  it("returns the SAME reference for no-op transitions (focus-regain re-registration)", () => {
    // The series screen re-registers active on EVERY focus regain; a no-op
    // must not produce a new state object or every consumer re-renders.
    let state = setActive(EMPTY_SERIES_LANGUAGE_STATE, "series-a")
    expect(setActive(state, "series-a")).toBe(state)

    state = setSelection(state, "series-a", "french")
    expect(setSelection(state, "series-a", "french")).toBe(state)
    expect(clearSeries(state, "series-never-seen")).toBe(state)
  })
})

// ── resolveTrailerSwap (R4 / AE9) ──────────────────────────────────

const HLS = "https://stream.mux.com/abc123.m3u8"

function dub(
  languageSlug: string,
  overrides: Partial<{ published: boolean; hls: string | null }> = {},
) {
  return { languageSlug, published: true, hls: HLS, ...overrides }
}

describe("resolveTrailerSwap", () => {
  const english = dub("english")

  it("swaps to the selected language's dub when it is playable", () => {
    const french = dub("french")
    const record = { variants: [english, french] }
    expect(resolveTrailerSwap(record, "french", english)).toBe(french)
  })

  it("keeps the prior dub when the selected language's dub is unplayable", () => {
    expect(
      resolveTrailerSwap(
        { variants: [english, dub("french", { hls: null })] },
        "french",
        english,
      ),
    ).toBe(english)
    expect(
      resolveTrailerSwap(
        { variants: [english, dub("french", { hls: "" })] },
        "french",
        english,
      ),
    ).toBe(english)
    expect(
      resolveTrailerSwap(
        { variants: [english, dub("french", { published: false })] },
        "french",
        english,
      ),
    ).toBe(english)
  })

  it("keeps the prior dub when the selected language has no dub at all", () => {
    expect(
      resolveTrailerSwap({ variants: [english] }, "swahili", english),
    ).toBe(english)
  })

  it("passes the current dub through when nothing is selected or no record", () => {
    expect(resolveTrailerSwap({ variants: [english] }, null, english)).toBe(
      english,
    )
    expect(resolveTrailerSwap(null, "french", english)).toBe(english)
    expect(resolveTrailerSwap(undefined, "french", null)).toBeNull()
  })

  it("probes playability with a null current: match → dub, no match → null", () => {
    const french = dub("french")
    const record = { variants: [english, french] }
    expect(resolveTrailerSwap(record, "french", null)).toBe(french)
    expect(resolveTrailerSwap(record, "swahili", null)).toBeNull()
  })

  it("matches by language SLUG, never bcp47 — ko vs ko-kmr do not collide", () => {
    // bcp47 prefixes collide (Korean "ko" vs Kurmanji "ko-kmr"); the slugs are
    // unique. Selecting Kurmanji must swap to the Kurmanji dub, never Korean.
    const korean = { ...dub("korean"), bcp47: "ko" }
    const kurmanji = { ...dub("kurdish-kurmanji"), bcp47: "ko-kmr" }
    const record = { variants: [korean, kurmanji] }
    expect(resolveTrailerSwap(record, "kurdish-kurmanji", korean)).toBe(
      kurmanji,
    )
    expect(resolveTrailerSwap(record, "korean", kurmanji)).toBe(korean)
  })
})

// ── buildLanguageRows (panel rows) ─────────────────────────────────

describe("buildLanguageRows", () => {
  const languages = [
    { slug: "spanish", name: "Spanish" },
    { slug: "french", name: "French" },
    { slug: "korean", name: null }, // null name → slug is the display name
  ]

  it("sorts A→Z by display name and marks the active slug", () => {
    const rows = buildLanguageRows(languages, "spanish")
    expect(rows.map((row) => row.language.slug)).toEqual([
      "french",
      "korean",
      "spanish",
    ])
    expect(rows.map((row) => row.active)).toEqual([false, false, true])
  })

  it("marks no row active when nothing is selected", () => {
    const rows = buildLanguageRows(languages, null)
    expect(rows.every((row) => !row.active)).toBe(true)
  })

  it("keeps every language — rows are never dropped or disabled", () => {
    expect(buildLanguageRows(languages, "french")).toHaveLength(
      languages.length,
    )
  })
})
