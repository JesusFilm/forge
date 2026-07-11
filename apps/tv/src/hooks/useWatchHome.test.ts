// The R8/R9/R10 resilience state machine is extracted as the pure
// reconcileWatchHome (the hook owns only the impure fetch + setState around it),
// so the ladder is unit-testable without rendering the hook — matching the TV
// codebase's homeScreenState.ts / homeCardRouting.ts discipline.

import {
  reconcileWatchHome,
  type WatchHomeReconcileInput,
} from "../lib/watchHome/experienceAdapter"
import type { WatchHomeModel, WatchHomeSection } from "../lib/watchHome/model"

const configModel: WatchHomeModel = {
  featured: [{ id: "hero" } as WatchHomeModel["featured"][number]],
  sections: [{ id: "config-row" } as WatchHomeSection],
  missingData: [],
}
const expSections = [{ id: "exp-row" } as WatchHomeSection]
const expBlocks = [{ __typename: "MediaCollectionBlock" }]

function reconcile(over: Partial<WatchHomeReconcileInput> = {}) {
  return reconcileWatchHome({
    primary: { kind: "ok", configModel },
    experienceSections: [],
    experienceOutcome: "absent",
    experienceBlocks: null,
    topUpFailed: false,
    ...over,
  })
}

describe("reconcileWatchHome — primary videos gate (R10, AE10)", () => {
  it("routes a rejected primary fetch to the retry-error state, not config rows", () => {
    expect(reconcile({ primary: { kind: "rejected" } })).toEqual({
      kind: "error",
    })
  })

  it("routes empty-but-successful-over-snapshot to retry-error", () => {
    expect(reconcile({ primary: { kind: "empty-over-snapshot" } })).toEqual({
      kind: "error",
    })
  })
})

describe("reconcileWatchHome — config fallback reasons (R8, R12)", () => {
  it("null homepageExperience → config rows + one `null` log (AE7)", () => {
    const result = reconcile({
      experienceOutcome: "absent",
      experienceSections: [],
    })
    expect(result).toMatchObject({ kind: "model", usedExperience: false })
    if (result.kind !== "model") throw new Error("expected model")
    expect(result.model).toBe(configModel)
    expect(result.logs).toEqual(["null"])
    // A definitive absent homepage CLEARS last-good (null), so a later transient
    // error can't resurrect the removed homepage (R9).
    expect(result.nextLastGoodBlocks).toBeNull()
  })

  it("leaves last-good unchanged on an error/empty fallback (no fresh signal)", () => {
    // "empty" = a present Experience that maps to zero rails.
    const errResult = reconcile({
      experienceOutcome: "error",
      experienceSections: [],
    })
    const emptyResult = reconcile({
      experienceOutcome: "present",
      experienceSections: [],
      experienceBlocks: expBlocks,
    })
    if (errResult.kind !== "model" || emptyResult.kind !== "model") {
      throw new Error("expected model")
    }
    expect(errResult.nextLastGoodBlocks).toBeUndefined()
    expect(emptyResult.nextLastGoodBlocks).toBeUndefined()
  })

  it("watchSetting error with no last-good → config rows + one `error` log (AE7)", () => {
    const result = reconcile({
      experienceOutcome: "error",
      experienceSections: [],
      experienceBlocks: null,
    })
    expect(result).toMatchObject({ kind: "model", usedExperience: false })
    if (result.kind !== "model") throw new Error("expected model")
    expect(result.logs).toEqual(["error"])
  })

  it("present Experience that maps to zero rails → config rows + one `empty` log (AE8)", () => {
    const result = reconcile({
      experienceOutcome: "present",
      experienceSections: [],
      experienceBlocks: expBlocks,
    })
    expect(result).toMatchObject({ kind: "model", usedExperience: false })
    if (result.kind !== "model") throw new Error("expected model")
    expect(result.logs).toEqual(["empty"])
  })
})

describe("reconcileWatchHome — Experience wins (R7, R9)", () => {
  it("renders the Experience rails and keeps config-sourced featured", () => {
    const result = reconcile({
      experienceOutcome: "present",
      experienceSections: expSections,
      experienceBlocks: expBlocks,
    })
    if (result.kind !== "model") throw new Error("expected model")
    expect(result.usedExperience).toBe(true)
    expect(result.model.sections).toBe(expSections)
    expect(result.model.featured).toBe(configModel.featured)
    // A clean Experience render logs nothing and remembers the good blocks.
    expect(result.logs).toEqual([])
    expect(result.nextLastGoodBlocks).toBe(expBlocks)
  })

  it("reused last-good over a live error → editor rows + one `error-recovered` log (AE9)", () => {
    const result = reconcile({
      experienceOutcome: "error",
      experienceSections: expSections,
      experienceBlocks: expBlocks,
    })
    if (result.kind !== "model") throw new Error("expected model")
    expect(result.usedExperience).toBe(true)
    expect(result.logs).toEqual(["error-recovered"])
    expect(result.nextLastGoodBlocks).toBe(expBlocks)
  })
})

describe("reconcileWatchHome — top-up degrade (R10, AE14)", () => {
  it("a good Experience with a dropped top-up → rails render + one `topup-error` log", () => {
    const result = reconcile({
      experienceOutcome: "present",
      experienceSections: expSections,
      experienceBlocks: expBlocks,
      topUpFailed: true,
    })
    if (result.kind !== "model") throw new Error("expected model")
    expect(result.usedExperience).toBe(true)
    // topup-error only — no retry state, no error-recovered.
    expect(result.logs).toEqual(["topup-error"])
  })

  it("appends topup-error alongside a config fallback reason", () => {
    const result = reconcile({
      experienceOutcome: "present",
      experienceSections: [],
      experienceBlocks: expBlocks,
      topUpFailed: true,
    })
    if (result.kind !== "model") throw new Error("expected model")
    expect(result.usedExperience).toBe(false)
    expect(result.logs).toEqual(["empty", "topup-error"])
  })
})
