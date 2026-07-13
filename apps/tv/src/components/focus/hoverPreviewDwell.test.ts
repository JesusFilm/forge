import {
  computeHoverPreviewActive,
  createHoverPreviewDwell,
  HOVER_PREVIEW_DWELL_MS,
} from "./hoverPreviewDwell"

describe("computeHoverPreviewActive (R3, R4)", () => {
  const base = {
    focused: true,
    enabled: true,
    playbackId: "pb123" as string | null | undefined,
    reduceMotion: false,
  }

  it("is true only when focused, enabled, has a playback id, and reduce-motion off", () => {
    expect(computeHoverPreviewActive(base)).toBe(true)
  })

  it("is false when not focused", () => {
    expect(computeHoverPreviewActive({ ...base, focused: false })).toBe(false)
  })

  it("is false when the surface is disabled (series-shaped)", () => {
    expect(computeHoverPreviewActive({ ...base, enabled: false })).toBe(false)
  })

  it("is false when the playback id is null / undefined / empty", () => {
    expect(computeHoverPreviewActive({ ...base, playbackId: null })).toBe(false)
    expect(computeHoverPreviewActive({ ...base, playbackId: undefined })).toBe(
      false,
    )
    expect(computeHoverPreviewActive({ ...base, playbackId: "" })).toBe(false)
  })

  it("is false when reduce-motion is on", () => {
    expect(computeHoverPreviewActive({ ...base, reduceMotion: true })).toBe(
      false,
    )
  })
})

describe("createHoverPreviewDwell (R1, R2)", () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it("fires onDwell once after the dwell delay of continuous active", () => {
    const onDwell = jest.fn()
    const onLeave = jest.fn()
    const dwell = createHoverPreviewDwell(onDwell, onLeave)

    dwell.setActive(true)
    expect(onDwell).not.toHaveBeenCalled()
    jest.advanceTimersByTime(HOVER_PREVIEW_DWELL_MS)
    expect(onDwell).toHaveBeenCalledTimes(1)
    expect(onLeave).not.toHaveBeenCalled()
  })

  it("does not fire when active goes false before the delay (D-pad pass-through)", () => {
    const onDwell = jest.fn()
    const onLeave = jest.fn()
    const dwell = createHoverPreviewDwell(onDwell, onLeave)

    dwell.setActive(true)
    jest.advanceTimersByTime(HOVER_PREVIEW_DWELL_MS - 1)
    dwell.setActive(false)
    jest.advanceTimersByTime(1000)
    expect(onDwell).not.toHaveBeenCalled()
    expect(onLeave).not.toHaveBeenCalled()
  })

  it("tears down via onLeave when active goes false after previewing", () => {
    const onDwell = jest.fn()
    const onLeave = jest.fn()
    const dwell = createHoverPreviewDwell(onDwell, onLeave)

    dwell.setActive(true)
    jest.advanceTimersByTime(HOVER_PREVIEW_DWELL_MS)
    dwell.setActive(false)
    expect(onLeave).toHaveBeenCalledTimes(1)
  })

  it("coalesces repeated active=true into a single dwell (one timer)", () => {
    const onDwell = jest.fn()
    const dwell = createHoverPreviewDwell(onDwell, jest.fn())

    dwell.setActive(true)
    dwell.setActive(true)
    dwell.setActive(true)
    jest.advanceTimersByTime(HOVER_PREVIEW_DWELL_MS)
    expect(onDwell).toHaveBeenCalledTimes(1)
  })

  it("cancel() clears a pending timer without firing onDwell (unmount)", () => {
    const onDwell = jest.fn()
    const onLeave = jest.fn()
    const dwell = createHoverPreviewDwell(onDwell, onLeave)

    dwell.setActive(true)
    dwell.cancel()
    jest.advanceTimersByTime(HOVER_PREVIEW_DWELL_MS)
    expect(onDwell).not.toHaveBeenCalled()
    expect(onLeave).not.toHaveBeenCalled()
  })

  it("cancel() after previewing does not fire onLeave (no setState post-unmount)", () => {
    const onDwell = jest.fn()
    const onLeave = jest.fn()
    const dwell = createHoverPreviewDwell(onDwell, onLeave)

    dwell.setActive(true)
    jest.advanceTimersByTime(HOVER_PREVIEW_DWELL_MS)
    dwell.cancel()
    expect(onLeave).not.toHaveBeenCalled()
  })
})
