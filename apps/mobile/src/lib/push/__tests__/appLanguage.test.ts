/**
 * Which app language a registration carries, and where it comes from before the
 * preferences provider has hydrated.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)

import AsyncStorage from "@react-native-async-storage/async-storage"

import {
  WATCH_PREFERENCES_STORAGE_KEY,
  serializeWatchPreferences,
  DEFAULT_WATCH_PREFERENCES,
} from "../../watchPreferences"
import {
  publishPushAppLanguageSlug,
  readPushAppLanguageSlug,
  resetPushAppLanguageForTests,
} from "../appLanguage"

beforeEach(async () => {
  resetPushAppLanguageForTests()
  await AsyncStorage.clear()
})

describe("readPushAppLanguageSlug", () => {
  it("reads the persisted preference before anything is published", async () => {
    await AsyncStorage.setItem(
      WATCH_PREFERENCES_STORAGE_KEY,
      serializeWatchPreferences({
        ...DEFAULT_WATCH_PREFERENCES,
        audioLanguageSlug: "arabic",
      }),
    )

    expect(await readPushAppLanguageSlug()).toBe("arabic")
  })

  it("answers null when the viewer has picked no language", async () => {
    expect(await readPushAppLanguageSlug()).toBeNull()
  })

  it("prefers the published value, which is what closes the write race", async () => {
    // The preferences provider persists without awaiting, so a payload built
    // from storage alone could read the previous slug.
    await AsyncStorage.setItem(
      WATCH_PREFERENCES_STORAGE_KEY,
      serializeWatchPreferences({
        ...DEFAULT_WATCH_PREFERENCES,
        audioLanguageSlug: "english",
      }),
    )
    publishPushAppLanguageSlug("korean")

    expect(await readPushAppLanguageSlug()).toBe("korean")
  })

  it("honours a published null, so clearing a pick is not ignored", async () => {
    await AsyncStorage.setItem(
      WATCH_PREFERENCES_STORAGE_KEY,
      serializeWatchPreferences({
        ...DEFAULT_WATCH_PREFERENCES,
        audioLanguageSlug: "english",
      }),
    )
    publishPushAppLanguageSlug(null)

    expect(await readPushAppLanguageSlug()).toBeNull()
  })

  it("answers null instead of throwing when storage fails", async () => {
    jest
      .spyOn(AsyncStorage, "getItem")
      .mockRejectedValueOnce(new Error("storage unavailable"))

    await expect(readPushAppLanguageSlug()).resolves.toBeNull()
    jest.restoreAllMocks()
  })
})
