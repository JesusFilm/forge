import { reloadAppAsync, requireNativeModule } from "expo"
import { Platform } from "react-native"
import { getStorage } from "./safeStorage"
import { restartWatchForPreview } from "./restartWatchForPreview"
import {
  DEFAULT_WATCH_PREFERENCES,
  serializeWatchPreferences,
  WATCH_PREFERENCES_STORAGE_KEY,
  type WatchPreferences,
} from "./watchPreferences"

jest.mock("expo", () => ({
  reloadAppAsync: jest.fn(),
  requireNativeModule: jest.fn(),
}))
jest.mock("./safeStorage", () => ({ getStorage: jest.fn() }))

const prefs: WatchPreferences = {
  ...DEFAULT_WATCH_PREFERENCES,
  startupAnimationId: "05",
  loadingAnimationId: "dots",
  audioLanguageSlug: "thai",
}
const setItem = jest.fn<Promise<void>, [string, string]>()
const nativeRestart = jest.fn<Promise<void>, []>()

beforeEach(() => {
  jest.clearAllMocks()
  setItem.mockReset().mockResolvedValue(undefined)
  nativeRestart.mockReset().mockResolvedValue(undefined)
  jest.mocked(getStorage).mockReturnValue({
    getItem: jest.fn(),
    setItem,
    removeItem: jest.fn(),
  })
  jest.mocked(requireNativeModule).mockReturnValue({
    restartAppForPreview: nativeRestart,
  })
})

afterEach(() => jest.restoreAllMocks())

test("Android waits for all selected preferences to save before native restart", async () => {
  jest.replaceProperty(Platform, "OS", "android")
  let finishSave!: () => void
  setItem.mockReturnValue(new Promise((resolve) => (finishSave = resolve)))
  const pending = restartWatchForPreview(prefs)
  expect(setItem).toHaveBeenCalledWith(
    WATCH_PREFERENCES_STORAGE_KEY,
    serializeWatchPreferences(prefs),
  )
  expect(requireNativeModule).not.toHaveBeenCalled()
  expect(nativeRestart).not.toHaveBeenCalled()
  finishSave()
  await pending
  expect(requireNativeModule).toHaveBeenCalledWith("NativeAndroidPlayer")
  expect(nativeRestart).toHaveBeenCalledTimes(1)
  expect(reloadAppAsync).not.toHaveBeenCalled()
})

test("Apple retains Expo reload without requiring an Android module", async () => {
  jest.replaceProperty(Platform, "OS", "ios")
  await restartWatchForPreview(prefs)
  expect(setItem).toHaveBeenCalledWith(
    WATCH_PREFERENCES_STORAGE_KEY,
    serializeWatchPreferences(prefs),
  )
  expect(reloadAppAsync).toHaveBeenCalledWith(
    "Preview selected startup animation",
  )
  expect(requireNativeModule).not.toHaveBeenCalled()
  expect(nativeRestart).not.toHaveBeenCalled()
})

test("a failed save does not restart or lose the selected preferences", async () => {
  jest.replaceProperty(Platform, "OS", "android")
  setItem.mockRejectedValue(new Error("storage failed"))
  await expect(restartWatchForPreview(prefs)).rejects.toThrow("storage failed")
  expect(requireNativeModule).not.toHaveBeenCalled()
  expect(reloadAppAsync).not.toHaveBeenCalled()
})

test("native errors reach Settings instead of falling back to broken JS reload", async () => {
  jest.replaceProperty(Platform, "OS", "android")
  nativeRestart.mockRejectedValue(new Error("Activity unavailable"))
  await expect(restartWatchForPreview(prefs)).rejects.toThrow(
    "Activity unavailable",
  )
  expect(reloadAppAsync).not.toHaveBeenCalled()
})
