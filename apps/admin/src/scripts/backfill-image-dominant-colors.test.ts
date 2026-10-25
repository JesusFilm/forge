import { beforeEach, describe, expect, it, vi } from "vitest"

const { generateDominantColorMock } = vi.hoisted(() => ({
  generateDominantColorMock: vi.fn(),
}))

vi.mock("@/services/image-metadata.service", () => ({
  generateDominantColor: generateDominantColorMock,
}))

import {
  parseArgs,
  runBackfill,
  selectTargets,
} from "./backfill-image-dominant-colors"

function dataUrl(bytes = [1, 2, 3]) {
  return `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`
}

function buildPrisma({
  videoRows = [],
  muxRows = [],
  videoUpdateCount = 1,
  muxUpdateCount = 1,
}: {
  videoRows?: Array<{ id: string; blurDataUrl: string | null }>
  muxRows?: Array<{ id: string; blurDataUrl: string }>
  videoUpdateCount?: number
  muxUpdateCount?: number
} = {}) {
  return {
    videoImage: {
      findMany: vi.fn().mockResolvedValue(videoRows),
      updateMany: vi.fn().mockResolvedValue({ count: videoUpdateCount }),
    },
    muxImageDerivative: {
      findMany: vi.fn().mockResolvedValue(muxRows),
      updateMany: vi.fn().mockResolvedValue({ count: muxUpdateCount }),
    },
  }
}

describe("backfill-image-dominant-colors args", () => {
  it("defaults to a dry-run over all sources", () => {
    expect(parseArgs([])).toEqual({
      source: "all",
      limit: 100,
      execute: false,
    })
  })

  it("parses source, limit, and execute", () => {
    expect(
      parseArgs(["--source=video-image", "--limit=20", "--execute"]),
    ).toEqual({
      source: "video-image",
      limit: 20,
      execute: true,
    })
  })

  it("rejects malformed source and limit values", () => {
    expect(() => parseArgs(["--source=media-asset"])).toThrow(
      "--source must be video-image, mux-image-derivative, or all",
    )
    expect(() => parseArgs(["--limit=10x"])).toThrow(
      "--limit must be a positive integer",
    )
    expect(() => parseArgs(["--limit=0"])).toThrow(
      "--limit must be a positive integer",
    )
  })
})

describe("backfill-image-dominant-colors selection", () => {
  it("selects video-image and mux derivative rows with missing colors", async () => {
    const prisma = buildPrisma({
      videoRows: [{ id: "video-image-1", blurDataUrl: dataUrl() }],
      muxRows: [{ id: "mux-1", blurDataUrl: dataUrl([4, 5, 6]) }],
    })

    await expect(
      selectTargets(prisma as never, {
        source: "all",
        limit: 10,
        execute: false,
      }),
    ).resolves.toEqual([
      {
        source: "video-image",
        id: "video-image-1",
        blurDataUrl: dataUrl(),
      },
      {
        source: "mux-image-derivative",
        id: "mux-1",
        blurDataUrl: dataUrl([4, 5, 6]),
      },
    ])
  })
})

describe("backfill-image-dominant-colors execution", () => {
  beforeEach(() => {
    generateDominantColorMock.mockReset()
    generateDominantColorMock.mockResolvedValue("#123456")
  })

  it("does not write during dry-run", async () => {
    const prisma = buildPrisma({
      videoRows: [{ id: "video-image-1", blurDataUrl: dataUrl() }],
    })

    const result = await runBackfill(prisma as never, {
      source: "video-image",
      limit: 1,
      execute: false,
    })

    expect(result).toMatchObject({
      selected: 1,
      processed: 1,
      updated: 1,
      dryRun: true,
    })
    expect(prisma.videoImage.updateMany).not.toHaveBeenCalled()
  })

  it("guards writes against rows changed after selection", async () => {
    const blurDataUrl = dataUrl()
    const prisma = buildPrisma({
      videoRows: [{ id: "video-image-1", blurDataUrl }],
    })

    await runBackfill(prisma as never, {
      source: "video-image",
      limit: 1,
      execute: true,
    })

    expect(prisma.videoImage.updateMany).toHaveBeenCalledWith({
      where: {
        id: "video-image-1",
        dominantColor: null,
        blurDataUrl,
      },
      data: { dominantColor: "#123456" },
    })
  })

  it("counts guarded no-op writes as skipped", async () => {
    const prisma = buildPrisma({
      muxRows: [{ id: "mux-1", blurDataUrl: dataUrl() }],
      muxUpdateCount: 0,
    })

    await expect(
      runBackfill(prisma as never, {
        source: "mux-image-derivative",
        limit: 1,
        execute: true,
      }),
    ).resolves.toMatchObject({
      selected: 1,
      processed: 1,
      updated: 0,
      skipped: 1,
      dryRun: false,
    })
  })
})
