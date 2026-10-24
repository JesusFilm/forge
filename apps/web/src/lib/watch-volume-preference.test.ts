/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest"

import {
  readWatchVolumePreference,
  writeWatchVolumePreference,
} from "@/lib/watch-volume-preference"

const STORAGE_KEY = "forge.watch.volumePreference"

afterEach(() => {
  window.localStorage.clear()
})

describe("watch volume preference", () => {
  it("round-trips muted and volume state", () => {
    writeWatchVolumePreference({ muted: true, volume: 0.35 })

    expect(readWatchVolumePreference()).toEqual({
      muted: true,
      volume: 0.35,
    })
  })

  it("ignores malformed and out-of-range stored values", () => {
    window.localStorage.setItem(STORAGE_KEY, "{")
    expect(readWatchVolumePreference()).toBeNull()

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ muted: false, volume: 2 }),
    )
    expect(readWatchVolumePreference()).toBeNull()

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ muted: "false", volume: 0.5 }),
    )
    expect(readWatchVolumePreference()).toBeNull()
  })

  it("does not write invalid volume values", () => {
    writeWatchVolumePreference({ muted: false, volume: Number.NaN })

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})
