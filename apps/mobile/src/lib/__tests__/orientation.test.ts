import {
  lockPortrait,
  enterLandscapeFollowDevice,
  exitToPortrait,
} from "../orientation"

// `mock`-prefixed so the jest.mock factory may reference them (hoisting rule).
const mockLockAsync = jest.fn<Promise<void>, [number]>()
const mockUnlockAsync = jest.fn<Promise<void>, []>()

const PORTRAIT_UP = 3
const LANDSCAPE = 5

jest.mock("expo-screen-orientation", () => ({
  lockAsync: (lock: number) => mockLockAsync(lock),
  unlockAsync: () => mockUnlockAsync(),
  OrientationLock: { PORTRAIT_UP: 3, LANDSCAPE: 5 },
}))

beforeEach(() => {
  mockLockAsync.mockReset().mockResolvedValue(undefined)
  mockUnlockAsync.mockReset().mockResolvedValue(undefined)
})

describe("orientation helper", () => {
  it("lockPortrait locks to PORTRAIT_UP", async () => {
    await lockPortrait()
    expect(mockLockAsync).toHaveBeenCalledWith(PORTRAIT_UP)
  })

  it("enterLandscapeFollowDevice locks LANDSCAPE then unlocks, in order", async () => {
    const order: string[] = []
    mockLockAsync.mockImplementation(async (lock) => {
      order.push(`lock:${lock}`)
    })
    mockUnlockAsync.mockImplementation(async () => {
      order.push("unlock")
    })

    await enterLandscapeFollowDevice()

    expect(order).toEqual([`lock:${LANDSCAPE}`, "unlock"])
  })

  it("exitToPortrait re-locks to PORTRAIT_UP", async () => {
    await exitToPortrait()
    expect(mockLockAsync).toHaveBeenCalledWith(PORTRAIT_UP)
  })

  it("swallows a rejected lock without throwing", async () => {
    mockLockAsync.mockRejectedValueOnce(new Error("unsupported"))
    await expect(lockPortrait()).resolves.toBeUndefined()
  })

  it("recovers to portrait when unlock rejects mid-enter (R16: only fullscreen rotates)", async () => {
    // lock(LANDSCAPE) succeeds, unlock rejects — the partial failure is swallowed.
    mockUnlockAsync.mockRejectedValueOnce(new Error("unlock failed"))
    await expect(enterLandscapeFollowDevice()).resolves.toBeUndefined()

    // A subsequent exit must still re-lock portrait — no stranded landscape state.
    mockLockAsync.mockClear()
    await exitToPortrait()
    expect(mockLockAsync).toHaveBeenCalledWith(PORTRAIT_UP)
  })
})
