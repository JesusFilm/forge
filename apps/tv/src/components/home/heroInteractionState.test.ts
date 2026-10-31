import {
  heroPresentationKey,
  clampHeroIndex,
  claimHomeMenuKey,
  scheduleHeroRotation,
  shouldReturnHomeToTop,
  shouldRotateHero,
} from "./heroInteractionState"

describe("focused hero presentation", () => {
  it("replaces an in-flight ambient presentation with the focused title", () => {
    expect(heroPresentationKey("jesus", false)).toBe(
      heroPresentationKey("stunned", false),
    )
    expect(heroPresentationKey("stunned", true)).not.toBe(
      heroPresentationKey("stunned", false),
    )
  })

  it("snaps both presentation layers on focused manual paging, without an activation lock", () => {
    const a = heroPresentationKey("a", true)
    const b = heroPresentationKey("b", true)
    expect(b).not.toBe(a)
    expect(heroPresentationKey("a", true)).toBe(a)
    // Unrelated renders and a Details/Next focus handoff keep the same layer.
    expect(heroPresentationKey("b", true)).toBe(b)
  })

  it("uses one clamped title for initial mount and after the featured set shrinks", () => {
    const slides = [{ id: "a" }, { id: "b" }]
    const card = slides[clampHeroIndex(4, slides.length)]
    expect(card.id).toBe("b")
    expect(heroPresentationKey(card.id, true)).toBe("focused:b")
    expect(clampHeroIndex(0, slides.length)).toBe(0)
    expect(clampHeroIndex(4, 0)).toBe(0)
    expect(heroPresentationKey(null, true)).toBe("focused:empty")
  })
})

describe("hero rotation ownership", () => {
  it.each([
    [true, false, 2, true],
    [true, true, 2, false],
    [false, false, 2, false],
    [false, true, 2, false],
    [true, false, 1, false],
    [true, false, 0, false],
  ] as const)(
    "active=%s focused=%s slides=%s rotates=%s",
    (active, focused, count, rotates) => {
      expect(shouldRotateHero(active, focused, count)).toBe(rotates)
    },
  )
})

describe("Home Back ownership", () => {
  it.each([
    [true, "deep", true],
    [true, "top", false],
    [true, "browse", false],
    [false, "deep", false],
    [false, "top", false],
  ] as const)(
    "active=%s state=%s returns to top=%s",
    (active, state, returns) => {
      expect(shouldReturnHomeToTop(active, state)).toBe(returns)
    },
  )
})

describe("hero dwell lifecycle", () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it.each([true, false])(
    "never advances during a 30-second focused dwell, active=%s",
    (active) => {
      const advance = jest.fn()
      scheduleHeroRotation(active, true, 3, advance, 7000)
      jest.advanceTimersByTime(30000)
      expect(advance).not.toHaveBeenCalled()
    },
  )

  it("cancels an off-hero dwell on route blur and starts a fresh dwell on return", () => {
    const advance = jest.fn()
    const cancel = scheduleHeroRotation(true, false, 3, advance, 7000)
    jest.advanceTimersByTime(6999)
    cancel?.()
    scheduleHeroRotation(false, false, 3, advance, 7000)
    jest.advanceTimersByTime(30000)
    expect(advance).not.toHaveBeenCalled()
    scheduleHeroRotation(true, false, 3, advance, 7000)
    jest.advanceTimersByTime(6999)
    expect(advance).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)
    expect(advance).toHaveBeenCalledTimes(1)
  })

  it("cancels rotation when either hero button gains focus", () => {
    const advance = jest.fn()
    const cancel = scheduleHeroRotation(true, false, 3, advance, 7000)
    jest.advanceTimersByTime(6000)
    cancel?.()
    scheduleHeroRotation(true, true, 3, advance, 7000)
    jest.advanceTimersByTime(30000)
    expect(advance).not.toHaveBeenCalled()
  })
})

describe("Home native Menu ownership", () => {
  const controls = () => ({
    enableTVMenuKey: jest.fn(),
    disableTVMenuKey: jest.fn(),
  })

  it("claims lower Home and releases once on blur or transition to top", () => {
    const menu = controls()
    const release = claimHomeMenuKey(true, "deep", true, menu)
    expect(menu.enableTVMenuKey).toHaveBeenCalledTimes(1)
    expect(menu.disableTVMenuKey).not.toHaveBeenCalled()
    release?.()
    release?.()
    expect(menu.disableTVMenuKey).toHaveBeenCalledTimes(1)
    expect(claimHomeMenuKey(true, "top", true, menu)).toBeUndefined()
    expect(menu.enableTVMenuKey).toHaveBeenCalledTimes(1)
  })

  it.each([
    [false, "deep", true],
    [true, "deep", false],
    [true, "browse", true],
    [true, "top", true],
  ] as const)(
    "leaves native Menu untouched active=%s state=%s tvOS=%s",
    (active, state, tvOS) => {
      const menu = controls()
      expect(claimHomeMenuKey(active, state, tvOS, menu)).toBeUndefined()
      expect(menu.enableTVMenuKey).not.toHaveBeenCalled()
      expect(menu.disableTVMenuKey).not.toHaveBeenCalled()
    },
  )

  it("reclaims Menu on a new lower-Home visit after a child screen", () => {
    const menu = controls()
    claimHomeMenuKey(true, "deep", true, menu)?.()
    expect(claimHomeMenuKey(false, "deep", true, menu)).toBeUndefined()
    const release = claimHomeMenuKey(true, "deep", true, menu)
    expect(menu.enableTVMenuKey).toHaveBeenCalledTimes(2)
    expect(menu.disableTVMenuKey).toHaveBeenCalledTimes(1)
    release?.()
    expect(menu.disableTVMenuKey).toHaveBeenCalledTimes(2)
  })
})
