import path from "node:path"
import { describe, expect, it, vi } from "vitest"

const cacheDir = vi.fn<() => string | undefined>()
vi.mock("../../config/env", () => ({
  getDevotionalCacheDir: () => cacheDir(),
}))

const { cacheDirFor } = await import("./devotional-cache")

/**
 * The cache is the one devotional directory that is written to, and it holds
 * paid narration. On an ephemeral filesystem it has to be pointed at a mounted
 * volume or every deploy re-voices everything, so the override is the part that
 * makes a deploy affordable rather than a convenience.
 */
describe("where the cache lives", () => {
  it("uses the override, keeping the per-devotional directory name", () => {
    cacheDir.mockReturnValue("/mnt/devo-cache")
    expect(cacheDirFor(19, 102)).toBe("/mnt/devo-cache/ch19-seq102")
  })

  it("keeps language and episode apart under the override", () => {
    cacheDir.mockReturnValue("/mnt/devo-cache")
    expect(cacheDirFor(33, 0, "ru")).toBe("/mnt/devo-cache/ch33-seq0-ru")
    expect(cacheDirFor(33, 0, "en", 2)).toBe("/mnt/devo-cache/ch33-seq0-ep2")
  })

  it("falls back to the in-repo path when unset", () => {
    cacheDir.mockReturnValue(undefined)
    const dir = cacheDirFor(19, 102)
    expect(dir.endsWith(path.join("devo/cache", "ch19-seq102"))).toBe(true)
  })
})
