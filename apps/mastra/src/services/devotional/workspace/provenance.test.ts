import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { LocalFilesystem } from "@mastra/core/workspace"
import { describe, expect, it } from "vitest"

import { writeInputsUsed } from "./provenance"

describe("writeInputsUsed", () => {
  it("writes bounded source references idempotently without source bodies", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "devo-provenance-"))
    const filesystem = new LocalFilesystem({ basePath: root })
    const options = {
      filesystem,
      runId: "run-1",
      catalogGeneration: 2,
      reconciledAt: "2026-07-31T12:00:00.000Z",
      sources: [
        {
          path: "/inputs/reflections/grace.md",
          category: "reflections" as const,
          digest: "a".repeat(64),
          size: 42,
          modifiedAt: "2026-07-31T11:00:00.000Z",
          title: "grace",
        },
      ],
    }

    await expect(writeInputsUsed(options)).resolves.toBe(
      "/runs/run-1/inputs-used.json",
    )
    await expect(writeInputsUsed(options)).resolves.toBe(
      "/runs/run-1/inputs-used.json",
    )
    const content = String(
      await filesystem.readFile("runs/run-1/inputs-used.json"),
    )
    expect(content).toContain('"digest"')
    expect(content).not.toContain("sourceBodies")
  })

  it("refuses to overwrite different provenance for the same attempt", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "devo-provenance-"))
    const filesystem = new LocalFilesystem({ basePath: root })
    const base = {
      filesystem,
      runId: "run-1",
      catalogGeneration: 2,
      reconciledAt: "2026-07-31T12:00:00.000Z",
      sources: [],
    }
    await writeInputsUsed(base)
    await expect(
      writeInputsUsed({ ...base, catalogGeneration: 3 }),
    ).rejects.toThrow(/Immutable devotional artifact conflict/u)
  })
})
