import {
  createControlsVisibleStore,
  nextControlsState,
  type ControlsState,
} from "../controlsVisibility"

// Locks the logical (visible, mounted) transitions — notably the fade-race
// invariants from ce-code-review #7, only reachable by tapping inside a ~150ms
// fade window on device. The hook's Animated/timer orchestration is sim-verified (R19).

const SHOWN: ControlsState = { visible: true, mounted: true }
const FADING: ControlsState = { visible: false, mounted: true } // hidden, mid fade-out
const HIDDEN: ControlsState = { visible: false, mounted: false }

describe("nextControlsState", () => {
  it("reveal returns fully visible + mounted from any prior state", () => {
    expect(nextControlsState(HIDDEN, "reveal")).toEqual(SHOWN)
    expect(nextControlsState(FADING, "reveal")).toEqual(SHOWN)
    expect(nextControlsState(SHOWN, "reveal")).toEqual(SHOWN)
  })

  it("hideStart marks not-visible immediately but stays mounted for the fade", () => {
    // The fade-eat fix: logical visibility drops at once, so a tap landing
    // mid-fade reads 'hidden' and routes to reveal rather than completing a hide.
    expect(nextControlsState(SHOWN, "hideStart")).toEqual(FADING)
  })

  it("hideDone unmounts on a normal (still-hidden) completion", () => {
    expect(nextControlsState(FADING, "hideDone")).toEqual(HIDDEN)
  })

  it("hideDone keeps the chrome mounted when a reveal won the race mid-fade", () => {
    // A reveal/interaction during the fade set visible=true; the late fade
    // completion is stale and must NOT unmount the chrome the user brought back.
    expect(nextControlsState(SHOWN, "hideDone")).toEqual(SHOWN)
  })

  it("reveal mid-fade then a stale hideDone leaves the chrome up (#7 core invariant)", () => {
    const fading = nextControlsState(SHOWN, "hideStart") // hidden, still mounted
    const revealed = nextControlsState(fading, "reveal") // brought back mid-fade
    expect(nextControlsState(revealed, "hideDone")).toEqual(SHOWN)
  })

  it("second cycle (hide -> reveal -> hide -> reveal) ends fully visible", () => {
    let s = SHOWN
    s = nextControlsState(s, "hideStart") // FADING
    s = nextControlsState(s, "hideDone") // HIDDEN
    s = nextControlsState(s, "reveal") // SHOWN
    s = nextControlsState(s, "hideStart") // FADING
    s = nextControlsState(s, "reveal") // reveal mid-fade -> SHOWN
    s = nextControlsState(s, "hideDone") // stale completion -> stays SHOWN
    expect(s).toEqual(SHOWN)
  })
})

describe("createControlsVisibleStore", () => {
  it("starts at the given value and tells each subscriber about a set", () => {
    const store = createControlsVisibleStore(true)
    expect(store.get()).toBe(true)
    const heard = jest.fn(() => store.get())

    store.subscribe(heard)
    store.set(false)

    expect(store.get()).toBe(false)
    expect(heard).toHaveBeenCalledTimes(1)
    expect(heard).toHaveReturnedWith(false)
  })

  // A control press writes "visible" again on every tap.
  it("does not tell subscribers about a set to the same value", () => {
    const store = createControlsVisibleStore(true)
    const heard = jest.fn()
    store.subscribe(heard)

    store.set(true)

    expect(heard).not.toHaveBeenCalled()
    expect(store.get()).toBe(true)
  })

  it("stops telling a listener once it unsubscribes", () => {
    const store = createControlsVisibleStore(false)
    const heard = jest.fn()
    const unsubscribe = store.subscribe(heard)

    unsubscribe()
    store.set(true)

    expect(heard).not.toHaveBeenCalled()
    expect(store.get()).toBe(true)
  })
})
