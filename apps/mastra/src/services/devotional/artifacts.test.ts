import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  createDevotionalArtifactStore,
  DevotionalArtifactError,
} from "./artifacts"
import type { DevotionalReport } from "./types"

const tmpDirs: string[] = []

function tmpRoot(): string {
  const dir = path.join(os.tmpdir(), `devo-artifacts-${randomUUID()}`)
  tmpDirs.push(dir)
  return dir
}

function report(overrides: Partial<DevotionalReport> = {}): DevotionalReport {
  return {
    schemaVersion: "1",
    kind: "daily-devotional",
    reportId: "2026-06-22",
    mastraRunId: "run-1",
    date: "2026-06-22",
    startedAt: "2026-06-22T07:00:00.000Z",
    finishedAt: "2026-06-22T07:00:05.000Z",
    published: true,
    videoMatch: "search",
    safety: {
      verdict: "pass",
      scores: { doctrine: 0.9, tone: 0.9, sensitivity: 0.9 },
      reasons: [],
    },
    devotional: {
      date: "2026-06-22",
      hook: {
        type: "question",
        title: "Where do you find peace?",
        summary: "Rest in Christ.",
        sourceUrl: null,
      },
      scripture: {
        reference: "John 14:27",
        text: "Peace I leave with you.",
        translation: "NIV",
        needsCanonicalSource: true,
      },
      video: null,
      videoMatch: "none",
      reflection: "Peace is the presence of Christ.",
      questions: ["Where is your fear loudest?"],
      furtherReading: null,
      blockOrder: ["hook", "scripture", "reflection", "questions"],
    },
    ...overrides,
  }
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises")
  await Promise.all(
    tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

describe("devotional artifact store", () => {
  it("writes and reads back a report", async () => {
    const store = createDevotionalArtifactStore(tmpRoot())
    const { path: filePath } = await store.writeReport(report())
    expect(filePath).toContain("2026-06-22.json")

    const loaded = await store.readReport("2026-06-22")
    expect(loaded.date).toBe("2026-06-22")
    expect(loaded.devotional?.scripture.reference).toBe("John 14:27")
  })

  it("throws not_found for a missing report", async () => {
    const store = createDevotionalArtifactStore(tmpRoot())
    await expect(store.readReport("2099-01-01")).rejects.toMatchObject({
      name: "DevotionalArtifactError",
      code: "not_found",
    })
  })

  it("rejects an unsafe report id", async () => {
    const store = createDevotionalArtifactStore(tmpRoot())
    await expect(
      store.writeReport(report({ reportId: "../evil" })),
    ).rejects.toMatchObject({ code: "invalid_name" })
  })

  it("rejects a report that fails schema validation", async () => {
    const store = createDevotionalArtifactStore(tmpRoot())
    await expect(
      // videoMatch is not a valid enum value.
      store.writeReport(
        report({ videoMatch: "bogus" as DevotionalReport["videoMatch"] }),
      ),
    ).rejects.toMatchObject({ code: "invalid_artifact" })
  })

  it("rejects a stored artifact that is not valid JSON", async () => {
    const root = tmpRoot()
    const store = createDevotionalArtifactStore(root)
    await mkdir(path.join(root, "reports"), { recursive: true })
    await writeFile(path.join(root, "reports", "2026-06-22.json"), "{ not json")
    await expect(store.readReport("2026-06-22")).rejects.toBeInstanceOf(
      DevotionalArtifactError,
    )
  })
})
