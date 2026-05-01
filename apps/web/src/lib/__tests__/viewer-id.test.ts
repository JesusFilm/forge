/**
 * @vitest-environment jsdom
 *
 * U5 — `getViewerId()` helper for the watch-page Mux Player.
 *
 * Contract:
 * - First call generates a UUID, persists it to `localStorage` under
 *   `forge.viewer_id`, and returns it.
 * - Subsequent calls return the same persisted UUID.
 * - On SSR (no `window`) returns the empty string — caller must guard.
 * - When `localStorage.setItem` throws (private browsing / quota), falls
 *   back to a per-call in-memory UUID without throwing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getViewerId } from "@/lib/viewer-id"

const VIEWER_ID_STORAGE_KEY = "forge.viewer_id"

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("getViewerId — happy path", () => {
  it("first call generates a UUID and persists it", () => {
    expect(window.localStorage.getItem(VIEWER_ID_STORAGE_KEY)).toBeNull()

    const id = getViewerId()

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    expect(window.localStorage.getItem(VIEWER_ID_STORAGE_KEY)).toBe(id)
  })

  it("subsequent calls return the same persisted UUID", () => {
    const first = getViewerId()
    const second = getViewerId()
    const third = getViewerId()

    expect(first).toBe(second)
    expect(second).toBe(third)
  })
})

describe("getViewerId — private-browsing fallback", () => {
  it("returns a string UUID when localStorage.setItem throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError")
    })

    const id = getViewerId()

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  it("returns a string UUID when localStorage.getItem throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError")
    })

    const id = getViewerId()

    expect(typeof id).toBe("string")
    expect(id.length).toBeGreaterThan(0)
  })
})
