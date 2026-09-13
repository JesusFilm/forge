import {
  getSeriesExportProgressSnapshot,
  publishSeriesExportProgress,
  resetSeriesExportProgressForTests,
  subscribeToSeriesExportProgress,
} from "../seriesExportProgress"

beforeEach(() => {
  resetSeriesExportProgressForTests()
})

describe("the live series export run", () => {
  it("holds one run per series and clears it on null", () => {
    publishSeriesExportProgress("washi-gospel", { saved: 2, total: 5 })
    expect(getSeriesExportProgressSnapshot()["washi-gospel"]).toEqual({
      saved: 2,
      total: 5,
    })

    publishSeriesExportProgress("washi-gospel", null)
    expect(getSeriesExportProgressSnapshot()["washi-gospel"]).toBeUndefined()
  })

  it("keeps two series apart", () => {
    publishSeriesExportProgress("washi-gospel", { saved: 1, total: 5 })
    publishSeriesExportProgress("light-series", { saved: 3, total: 4 })

    publishSeriesExportProgress("washi-gospel", null)

    expect(getSeriesExportProgressSnapshot()).toEqual({
      "light-series": { saved: 3, total: 4 },
    })
  })

  it("notifies on a change and stays silent on a repeat", () => {
    const listener = jest.fn()
    subscribeToSeriesExportProgress(listener)

    publishSeriesExportProgress("washi-gospel", { saved: 1, total: 5 })
    expect(listener).toHaveBeenCalledTimes(1)

    // The run republishes after every episode, saved or not. An unchanged
    // count must not re-render the screen.
    publishSeriesExportProgress("washi-gospel", { saved: 1, total: 5 })
    expect(listener).toHaveBeenCalledTimes(1)

    publishSeriesExportProgress("washi-gospel", { saved: 2, total: 5 })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("stays silent clearing a run that was never there", () => {
    const listener = jest.fn()
    subscribeToSeriesExportProgress(listener)

    publishSeriesExportProgress("washi-gospel", null)
    expect(listener).not.toHaveBeenCalled()
  })

  it("takes a new snapshot identity on every change", () => {
    // useSyncExternalStore compares by identity, so a mutated object would
    // leave the ring frozen at whatever it drew first.
    const first = getSeriesExportProgressSnapshot()
    publishSeriesExportProgress("washi-gospel", { saved: 1, total: 5 })
    const second = getSeriesExportProgressSnapshot()
    publishSeriesExportProgress("washi-gospel", { saved: 2, total: 5 })

    expect(second).not.toBe(first)
    expect(getSeriesExportProgressSnapshot()).not.toBe(second)
  })

  it("keeps the snapshot stable when nothing changed", () => {
    publishSeriesExportProgress("washi-gospel", { saved: 1, total: 5 })
    const stable = getSeriesExportProgressSnapshot()
    publishSeriesExportProgress("washi-gospel", { saved: 1, total: 5 })

    expect(getSeriesExportProgressSnapshot()).toBe(stable)
  })

  it("ignores an empty slug, which names no series", () => {
    publishSeriesExportProgress("", { saved: 1, total: 5 })
    expect(getSeriesExportProgressSnapshot()).toEqual({})
  })

  it("survives a subscriber that throws", () => {
    const good = jest.fn()
    subscribeToSeriesExportProgress(() => {
      throw new Error("bad subscriber")
    })
    subscribeToSeriesExportProgress(good)

    expect(() =>
      publishSeriesExportProgress("washi-gospel", { saved: 1, total: 5 }),
    ).not.toThrow()
    expect(good).toHaveBeenCalledTimes(1)
  })

  it("stops notifying once unsubscribed", () => {
    const listener = jest.fn()
    const unsubscribe = subscribeToSeriesExportProgress(listener)
    unsubscribe()

    publishSeriesExportProgress("washi-gospel", { saved: 1, total: 5 })
    expect(listener).not.toHaveBeenCalled()
  })
})
