import {
  lockPortrait,
  enterFullscreenLandscape,
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

  it("enterFullscreenLandscape locks LANDSCAPE and does NOT unlock", async () => {
    // Unlock would immediately follow the device back to portrait on iOS, so
    // the lock must stand on its own.
    await enterFullscreenLandscape()
    expect(mockLockAsync).toHaveBeenCalledWith(LANDSCAPE)
    expect(mockUnlockAsync).not.toHaveBeenCalled()
  })

  it("exitToPortrait re-locks to PORTRAIT_UP", async () => {
    await exitToPortrait()
    expect(mockLockAsync).toHaveBeenCalledWith(PORTRAIT_UP)
  })

  it("swallows a rejected lock without throwing", async () => {
    mockLockAsync.mockRejectedValueOnce(new Error("unsupported"))
    await expect(lockPortrait()).resolves.toBeUndefined()
    mockLockAsync.mockRejectedValueOnce(new Error("unsupported"))
    await expect(enterFullscreenLandscape()).resolves.toBeUndefined()
  })

  it("exitToPortrait still recovers after a failed enter (R16: only fullscreen rotates)", async () => {
    mockLockAsync.mockRejectedValueOnce(new Error("enter failed"))
    await expect(enterFullscreenLandscape()).resolves.toBeUndefined()
    mockLockAsync.mockClear()
    await exitToPortrait()
    expect(mockLockAsync).toHaveBeenCalledWith(PORTRAIT_UP)
  })
})
