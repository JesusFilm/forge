import { beforeEach, describe, expect, it, vi } from "vitest"

const { getOrCreateVideoImageBlurDataUrlMock } = vi.hoisted(() => ({
  getOrCreateVideoImageBlurDataUrlMock: vi.fn(),
}))

vi.mock("@/services/video-image-blur-data-url.service", () => ({
  getOrCreateVideoImageBlurDataUrl: getOrCreateVideoImageBlurDataUrlMock,
}))

import {
  parseArgs,
  runBackfill,
  selectVideoImageBlurDataUrlTargets,
  validateArgs,
} from "./backfill-video-image-blur-data-url"

function buildPrisma(rows: ReturnType<typeof row>[] = []) {
  return {
    videoImage: {
      findMany: vi.fn().mockResolvedValue(rows),
    },
  }
}

function row(overrides = {}) {
  return {
    id: "image-1",
    videoId: "video-1",
    mobileCinematicHigh: null,
    mobileCinematicLow: null,
    videoStill: null,
    thumbnail: null,
    url: null,
    blurDataUrl: null,
    video: { slug: "jesus" },
    ...overrides,
  }
}

describe("backfill-video-image-blur-data-url args", () => {
  beforeEach(() => {
    getOrCreateVideoImageBlurDataUrlMock.mockReset()
  })

  it("defaults to dry-run and rejects broad runs without a guard", () => {
    const args = parseArgs([])

    expect(args.execute).toBe(false)
    expect(args.fullCatalog).toBe(false)
    expect(args.batchSize).toBe(10)
    expect(() => validateArgs(args)).toThrow(
      /Refusing broad video-image blur-data-url backfill/,
    )
  })

  it("parses guarded execute options", () => {
    const args = parseArgs([
      "--full-catalog",
      "--execute",
      "--verbose",
      "--batch-size=5",
      "--limit=20",
      "--slug=jesus",
      "--video-id=video-1",
      "--image-id=image-1",
    ])

    expect(args).toMatchObject({
      fullCatalog: true,
      execute: true,
      verbose: true,
      batchSize: 5,
      limit: 20,
      slug: "jesus",
      videoId: "video-1",
      imageId: "image-1",
    })
    expect(() => validateArgs(args)).not.toThrow()
  })

  it("rejects malformed and nonpositive numeric flags", () => {
    for (const flag of ["limit", "batch-size"]) {
      expect(() => parseArgs([`--${flag}=10x`])).toThrow(
        `--${flag} must be a positive integer`,
      )
      expect(() => parseArgs([`--${flag}=0`])).toThrow(
        `--${flag} must be a positive integer`,
      )
    }
  })
})

describe("backfill-video-image-blur-data-url selection", () => {
  it("uses the same image priority as search-card hydration", async () => {
    const prisma = buildPrisma([
      row({
        mobileCinematicHigh: null,
        mobileCinematicLow: "https://image.test/mobile-low.jpg",
        videoStill: "https://image.test/still.jpg",
        thumbnail: "https://image.test/thumb.jpg",
        url: "https://image.test/source.jpg",
      }),
      row({
        id: "image-2",
        mobileCinematicHigh: "https://image.test/mobile-high.jpg",
        mobileCinematicLow: "https://image.test/mobile-low-2.jpg",
      }),
    ])

    const targets = await selectVideoImageBlurDataUrlTargets(prisma as never, {
      limit: 2,
      fullCatalog: false,
      execute: false,
      verbose: false,
      batchSize: 10,
    })

    expect(targets.map((target) => target.imageUrl)).toEqual([
      "https://image.test/mobile-low.jpg",
      "https://image.test/mobile-high.jpg",
    ])
  })
})

describe("backfill-video-image-blur-data-url execution", () => {
  beforeEach(() => {
    getOrCreateVideoImageBlurDataUrlMock.mockReset()
  })

  it("does not write during dry-run", async () => {
    const prisma = buildPrisma([
      row({ mobileCinematicHigh: "https://image.test/mobile-high.jpg" }),
    ])

    const result = await runBackfill(prisma as never, {
      limit: 1,
      fullCatalog: false,
      execute: false,
      verbose: false,
      batchSize: 10,
    })

    expect(result).toMatchObject({
      selected: 1,
      processed: 1,
      generated: 0,
      dryRun: true,
    })
    expect(getOrCreateVideoImageBlurDataUrlMock).not.toHaveBeenCalled()
  })

  it("generates blur data URLs when executed", async () => {
    const prisma = buildPrisma([
      row({ mobileCinematicHigh: "https://image.test/mobile-high.jpg" }),
    ])
    getOrCreateVideoImageBlurDataUrlMock.mockResolvedValue(
      "data:image/jpeg;base64,abc",
    )

    const result = await runBackfill(prisma as never, {
      limit: 1,
      fullCatalog: false,
      execute: true,
      verbose: false,
      batchSize: 10,
    })

    expect(result).toMatchObject({
      selected: 1,
      processed: 1,
      generated: 1,
      failed: 0,
      dryRun: false,
    })
    expect(getOrCreateVideoImageBlurDataUrlMock).toHaveBeenCalledWith({
      prisma,
      imageId: "image-1",
      imageUrl: "https://image.test/mobile-high.jpg",
    })
  })
})
