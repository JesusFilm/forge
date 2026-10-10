import {
  INITIAL_SELECTION_STATE,
  deselectAll,
  enterSelection,
  exitSelection,
  pruneToExisting,
  selectAll,
  selectionSummary,
  seriesSelectionState,
  toggleSeriesHeader,
  toggleSeriesSlugs,
  toggleSlug,
  type LibrarySelectionState,
} from "../librarySelection"
import {
  OFFLINE_MANIFEST_VERSION,
  type OfflineDownloadRecord,
  type OfflineDownloadState,
} from "../offlineManifest"

function record(
  videoSlug: string,
  state: OfflineDownloadState,
  overrides: Partial<OfflineDownloadRecord> = {},
): OfflineDownloadRecord {
  return {
    version: OFFLINE_MANIFEST_VERSION,
    videoSlug,
    dubDocumentId: "dub",
    renditionDocumentId: "rend",
    qualityLabel: "High",
    title: "Test",
    subtitleLanguageSlug: null,
    state,
    committedPath: null,
    pendingPath: null,
    posterPath: null,
    bytesWritten: 0,
    totalBytes: 0,
    ...overrides,
  }
}

const SERIES_EPISODES = Array.from({ length: 10 }, (_, i) => `ep${i}`)

function selectingState(slugs: readonly string[]): LibrarySelectionState {
  return { selecting: true, selected: new Set(slugs) }
}

describe("seriesSelectionState (AE2)", () => {
  it("is 'some' when 3 of 10 episodes are selected", () => {
    const selected = new Set(SERIES_EPISODES.slice(0, 3))
    expect(seriesSelectionState(SERIES_EPISODES, selected)).toBe("some")
  })

  it("is 'all' / 'none' at the boundaries", () => {
    expect(
      seriesSelectionState(SERIES_EPISODES, new Set(SERIES_EPISODES)),
    ).toBe("all")
    expect(seriesSelectionState(SERIES_EPISODES, new Set())).toBe("none")
  })
})

describe("toggleSeriesHeader (AE2)", () => {
  it("selects all episodes when 3 of 10 are selected (not all)", () => {
    const state = selectingState(SERIES_EPISODES.slice(0, 3))
    const next = toggleSeriesHeader(state, SERIES_EPISODES)
    expect(seriesSelectionState(SERIES_EPISODES, next.selected)).toBe("all")
    expect(next.selected.size).toBe(10)
  })

  it("deselects all episodes once every one is already selected", () => {
    const state = selectingState(SERIES_EPISODES)
    const next = toggleSeriesHeader(state, SERIES_EPISODES)
    expect(seriesSelectionState(SERIES_EPISODES, next.selected)).toBe("none")
    expect(next.selected.size).toBe(0)
  })
})

describe("pruneToExisting (R20 — live intersection)", () => {
  it("drops a selected slug that no longer exists and reports changed", () => {
    const state = selectingState(["a", "b"])
    const result = pruneToExisting(state, new Set(["a"]))
    expect(result.changed).toBe(true)
    expect(result.state.selected).toEqual(new Set(["a"]))
    expect(result.autoExit).toBe(false)
  })

  it("reports no change when the selection is already a subset of what exists", () => {
    const state = selectingState(["a"])
    const result = pruneToExisting(state, new Set(["a", "b"]))
    expect(result.changed).toBe(false)
    expect(result.state.selected).toEqual(new Set(["a"]))
  })

  it("signals auto-exit when the pruned intersection is empty", () => {
    const state = selectingState(["a"])
    const result = pruneToExisting(state, new Set(["b"]))
    expect(result.autoExit).toBe(true)
    expect(result.state).toEqual(exitSelection())
  })

  it("signals auto-exit when the whole record list is empty", () => {
    const state = selectingState(["a"])
    const result = pruneToExisting(state, new Set())
    expect(result.autoExit).toBe(true)
  })

  it("is a no-op outside selection mode", () => {
    const result = pruneToExisting(INITIAL_SELECTION_STATE, new Set())
    expect(result.changed).toBe(false)
    expect(result.autoExit).toBe(false)
    expect(result.state).toBe(INITIAL_SELECTION_STATE)
  })

  it("never auto-exits an already-empty selection just because the list is non-empty (the spurious-exit bug)", () => {
    const state = selectingState([])
    const result = pruneToExisting(state, new Set(["a", "b"]))
    expect(result.changed).toBe(false)
    expect(result.autoExit).toBe(false)
    expect(result.state.selecting).toBe(true)
  })

  it("auto-exits (and returns an exited state) once a non-empty selection is pruned to nothing", () => {
    const state = selectingState(["a", "b"])
    const result = pruneToExisting(state, new Set(["c"]))
    expect(result.autoExit).toBe(true)
    expect(result.state).toEqual(exitSelection())
  })

  it("auto-exits (and returns an exited state) when the whole record list empties, even with an empty selection", () => {
    const state = selectingState([])
    const result = pruneToExisting(state, new Set())
    expect(result.autoExit).toBe(true)
    expect(result.state).toEqual(exitSelection())
  })

  it("reports changed + no auto-exit for a partial prune that leaves some selection intact", () => {
    const state = selectingState(["a", "b"])
    const result = pruneToExisting(state, new Set(["a", "c"]))
    expect(result.changed).toBe(true)
    expect(result.autoExit).toBe(false)
    expect(result.state.selected).toEqual(new Set(["a"]))
  })
})

describe("selectionSummary — derived labels", () => {
  it("computes count, combined bytes, and has-failed over a mixed selection", () => {
    const records = [
      record("a", "downloaded", { totalBytes: 100 }),
      record("b", "downloading", { bytesWritten: 30, totalBytes: 200 }),
      record("c", "failed", { totalBytes: 999 }),
    ]
    expect(selectionSummary(new Set(["a", "b", "c"]), records)).toEqual({
      count: 3,
      combinedBytes: 130,
      hasFailed: true,
    })
  })

  it("has-failed is false when no selected slug is failed", () => {
    const records = [record("a", "downloaded", { totalBytes: 100 })]
    expect(selectionSummary(new Set(["a"]), records).hasFailed).toBe(false)
  })

  it("ignores a selected slug that isn't (yet) in the record list", () => {
    const records = [record("a", "downloaded", { totalBytes: 100 })]
    expect(selectionSummary(new Set(["a", "gone"]), records)).toEqual({
      count: 2,
      combinedBytes: 100,
      hasFailed: false,
    })
  })

  it("is zeroed for an empty selection", () => {
    expect(selectionSummary(new Set(), [])).toEqual({
      count: 0,
      combinedBytes: 0,
      hasFailed: false,
    })
  })
})

describe("selection entry/toggle primitives", () => {
  it("enterSelection seeds the initial slug(s) and turns selecting on", () => {
    expect(enterSelection(["a"])).toEqual({
      selecting: true,
      selected: new Set(["a"]),
    })
    expect(enterSelection(["a", "b"])).toEqual({
      selecting: true,
      selected: new Set(["a", "b"]),
    })
  })

  it("exitSelection clears selection and turns selecting off", () => {
    expect(exitSelection()).toEqual({ selecting: false, selected: new Set() })
  })

  it("toggleSlug adds then removes a slug", () => {
    let state = enterSelection([])
    state = toggleSlug(state, "a")
    expect(state.selected.has("a")).toBe(true)
    state = toggleSlug(state, "a")
    expect(state.selected.has("a")).toBe(false)
  })

  it("toggleSeriesSlugs adds or removes a whole set", () => {
    let state = enterSelection([])
    state = toggleSeriesSlugs(state, ["a", "b"], true)
    expect(state.selected).toEqual(new Set(["a", "b"]))
    state = toggleSeriesSlugs(state, ["a", "b"], false)
    expect(state.selected).toEqual(new Set())
  })

  it("selectAll/deselectAll set the selection to all/none of the given slugs", () => {
    let state = enterSelection([])
    state = selectAll(state, ["a", "b", "c"])
    expect(state.selected).toEqual(new Set(["a", "b", "c"]))
    state = deselectAll(state)
    expect(state.selected).toEqual(new Set())
  })
})
