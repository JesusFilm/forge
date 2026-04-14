import { describe, expect, it, vi, beforeEach } from "vitest"
import { resolveScope } from "./orchestrator"

vi.mock("./lock", () => ({
  acquireSyncLock: vi.fn(),
  releaseSyncLock: vi.fn(),
}))

vi.mock("./watermark", () => ({
  getWatermark: vi.fn().mockResolvedValue(null),
  advanceWatermark: vi.fn().mockResolvedValue(undefined),
  updateStatsOnly: vi.fn().mockResolvedValue(undefined),
  getAllWatermarks: vi.fn().mockResolvedValue([]),
}))

vi.mock("./phases/sync-languages", () => ({
  syncLanguages: vi.fn(),
}))
vi.mock("./phases/sync-countries", () => ({
  syncCountries: vi.fn(),
}))
vi.mock("./phases/sync-keywords", () => ({
  syncKeywords: vi.fn(),
}))
vi.mock("./phases/sync-videos", () => ({
  syncVideos: vi.fn(),
}))
vi.mock("./phases/sync-dubs", () => ({
  syncDubs: vi.fn(),
}))

describe("resolveScope", () => {
  it("returns all phases for undefined input", () => {
    expect(resolveScope()).toEqual([
      "languages",
      "countries",
      "keywords",
      "videos",
      "video-dubs",
    ])
  })

  it("returns all phases for string 'all'", () => {
    expect(resolveScope("all")).toEqual([
      "languages",
      "countries",
      "keywords",
      "videos",
      "video-dubs",
    ])
  })

  it("returns all phases for array ['all'] (GraphQL mutation path)", () => {
    expect(resolveScope(["all"])).toEqual([
      "languages",
      "countries",
      "keywords",
      "videos",
      "video-dubs",
    ])
  })

  it("returns single phase", () => {
    expect(resolveScope("languages")).toEqual(["languages"])
  })

  it("preserves canonical order regardless of input order", () => {
    expect(resolveScope(["videos", "languages", "keywords"])).toEqual([
      "languages",
      "keywords",
      "videos",
    ])
  })

  it("filters out invalid phases", () => {
    expect(resolveScope(["languages", "invalid-phase"])).toEqual(["languages"])
  })

  it("returns empty array for entirely invalid input", () => {
    expect(resolveScope(["nope"])).toEqual([])
  })
})

describe("runSync", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns skipped when lock is held", async () => {
    const { acquireSyncLock } = await import("./lock")
    ;(acquireSyncLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false)

    const { runSync } = await import("./orchestrator")
    const mockPrisma = {} as Parameters<typeof runSync>[0]

    const result = await runSync(mockPrisma)
    expect(result.skipped).toBe(true)
  })

  it("advances watermark when phase has zero errors", async () => {
    const { acquireSyncLock, releaseSyncLock } = await import("./lock")
    const { advanceWatermark, getWatermark } = await import("./watermark")
    const { syncLanguages } = await import("./phases/sync-languages")

    ;(acquireSyncLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true)
    ;(releaseSyncLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      undefined,
    )
    ;(getWatermark as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    ;(syncLanguages as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      created: 5,
      updated: 0,
      softDeleted: 0,
      errors: 0,
    })

    const mockPrisma = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof import("./orchestrator").runSync>[0]

    const { runSync } = await import("./orchestrator")
    await runSync(mockPrisma, { scope: "languages" })

    expect(advanceWatermark).toHaveBeenCalled()
  })

  it("does NOT advance watermark when phase has errors", async () => {
    const { acquireSyncLock, releaseSyncLock } = await import("./lock")
    const { advanceWatermark, updateStatsOnly, getWatermark } =
      await import("./watermark")
    const { syncLanguages } = await import("./phases/sync-languages")

    ;(acquireSyncLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true)
    ;(releaseSyncLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      undefined,
    )
    ;(getWatermark as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    ;(syncLanguages as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      created: 3,
      updated: 0,
      softDeleted: 0,
      errors: 2,
    })

    const mockPrisma = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof import("./orchestrator").runSync>[0]

    const { runSync } = await import("./orchestrator")
    await runSync(mockPrisma, { scope: "languages" })

    expect(advanceWatermark).not.toHaveBeenCalled()
    expect(updateStatsOnly).toHaveBeenCalled()
  })

  it("releases lock even when phase throws", async () => {
    const { acquireSyncLock, releaseSyncLock } = await import("./lock")
    const { getWatermark } = await import("./watermark")
    const { syncLanguages } = await import("./phases/sync-languages")

    ;(acquireSyncLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true)
    ;(releaseSyncLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      undefined,
    )
    ;(getWatermark as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    ;(syncLanguages as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Core API down"),
    )

    const mockPrisma = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof import("./orchestrator").runSync>[0]

    const { runSync } = await import("./orchestrator")
    const result = await runSync(mockPrisma, { scope: "languages" })

    expect(releaseSyncLock).toHaveBeenCalled()
    expect(result.phases[0].errors).toBe(1)
  })
})
