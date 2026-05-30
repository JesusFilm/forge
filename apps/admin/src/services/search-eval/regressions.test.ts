import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { RegressionLoadError, loadRegressions } from "./regressions"

let tmp: string
let filePath: string

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "regressions-test-"))
  filePath = path.join(tmp, "regressions.json")
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe("loadRegressions", () => {
  it("returns [] for an empty entries array", async () => {
    await writeFile(filePath, JSON.stringify({ entries: [] }))
    const out = await loadRegressions({ filePath })
    expect(out).toEqual([])
  })

  it("flattens valid entries with source: regression", async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        entries: [
          {
            locale: "fr",
            query: "espoir dans la souffrance",
            notes: "should return Hope videos, not random ones",
            addedAt: "2026-05-07T10:00:00Z",
            addedBy: "nisal",
          },
          { locale: "en", query: "John 3:16" },
        ],
      }),
    )

    const out = await loadRegressions({ filePath })
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({
      locale: "fr",
      query: "espoir dans la souffrance",
      source: "regression",
      notes: "should return Hope videos, not random ones",
    })
    expect(out[1]).toMatchObject({
      locale: "en",
      query: "John 3:16",
      source: "regression",
    })
  })

  it("returns [] when file is missing and allowMissing=true (default)", async () => {
    const missing = path.join(tmp, "absent.json")
    const out = await loadRegressions({ filePath: missing })
    expect(out).toEqual([])
  })

  it("throws RegressionLoadError when file missing and allowMissing=false", async () => {
    const missing = path.join(tmp, "absent.json")
    await expect(
      loadRegressions({ filePath: missing, allowMissing: false }),
    ).rejects.toMatchObject({
      name: "RegressionLoadError",
      code: "not_found",
    })
  })

  it("throws on invalid JSON", async () => {
    await writeFile(filePath, "not valid {")
    await expect(loadRegressions({ filePath })).rejects.toMatchObject({
      code: "invalid_json",
    })
  })

  it("throws on entries missing required fields", async () => {
    await writeFile(filePath, JSON.stringify({ entries: [{ locale: "en" }] }))
    await expect(loadRegressions({ filePath })).rejects.toMatchObject({
      code: "validation",
    })
  })

  it("throws on top-level shape mismatch", async () => {
    await writeFile(filePath, JSON.stringify({ unexpected: true }))
    await expect(loadRegressions({ filePath })).rejects.toMatchObject({
      code: "validation",
    })
  })

  it("includes the validation error path in the message", async () => {
    await writeFile(
      filePath,
      JSON.stringify({ entries: [{ locale: "", query: "" }] }),
    )
    try {
      await loadRegressions({ filePath })
      throw new Error("expected throw")
    } catch (err) {
      expect(err).toBeInstanceOf(RegressionLoadError)
      const message = (err as Error).message
      expect(message).toMatch(/entries|locale|query/i)
    }
  })

  it("ignores extra fields on entries", async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        entries: [
          {
            locale: "es",
            query: "esperanza",
            extra: "ignored",
            another: 123,
          },
        ],
      }),
    )
    const out = await loadRegressions({ filePath })
    expect(out[0]).toMatchObject({
      locale: "es",
      query: "esperanza",
      source: "regression",
    })
  })

  it("appends promoted sanitized candidates when prisma is provided", async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        entries: [{ locale: "en", query: "hand edited", notes: "manual" }],
      }),
    )
    const prisma = {
      searchEvalCandidate: {
        findMany: vi.fn(async () => [
          {
            id: "candidate-1",
            locale: "en",
            sanitizedQueryText: "Who is Jesus?",
            sanitizedExpectedResultNotes: "Should surface Jesus overview",
            sanitizedSourceAnchors: [{ type: "video", id: "video-1" }],
            reviewerIdentity: "nisal",
            promotedAt: new Date("2026-05-28T00:00:00.000Z"),
          },
        ]),
      },
    }

    const out = await loadRegressions({
      filePath,
      prisma: prisma as never,
    })

    expect(out).toEqual([
      {
        locale: "en",
        query: "hand edited",
        source: "regression",
        notes: "manual",
      },
      {
        locale: "en",
        query: "Who is Jesus?",
        source: "promoted",
        notes: "Should surface Jesus overview",
        promotedCandidateId: "candidate-1",
        sourceAnchors: [{ type: "video", id: "video-1" }],
        reviewerIdentity: "nisal",
        promotedAt: "2026-05-28T00:00:00.000Z",
      },
    ])
    expect(prisma.searchEvalCandidate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          promotionStatus: "PROMOTED",
          sanitizationStatus: "SANITIZED",
        }),
      }),
    )
  })
})
