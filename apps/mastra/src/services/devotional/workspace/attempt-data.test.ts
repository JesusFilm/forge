import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"

import type { WorkspaceFilesystem } from "@mastra/core/workspace"
import { describe, expect, it } from "vitest"

import { DEVOTIONAL_AUTHORED_PATHS } from "../authored-data"
import { categoryForWorkspacePath } from "./schemas"
import {
  createAttemptAuthoredDataReader,
  loadDevotionalAttemptAuthoredData,
} from "./attempt-data"
import type { DevotionalSourceRef } from "./state-schema"

const modifiedAt = new Date("2026-07-31T12:00:00.000Z")

function fixture(workspacePath: string): string {
  return readFileSync(
    path.join("devotional-workspace", workspacePath.replace(/^\//u, "")),
    "utf8",
  )
}

function harness() {
  const values = new Map<string, Buffer>()
  for (const workspacePath of Object.values(DEVOTIONAL_AUTHORED_PATHS)) {
    values.set(workspacePath.slice(1), Buffer.from(fixture(workspacePath)))
  }
  values.set(
    "inputs/reflections/new-source.md",
    Buffer.from("Grace meets a fearful heart with steady hope."),
  )
  const sources: DevotionalSourceRef[] = [...values.entries()].map(
    ([nativePath, content]) => {
      const workspacePath = `/${nativePath}`
      const category = categoryForWorkspacePath(workspacePath)
      if (!category) throw new Error(`uncategorized test path ${workspacePath}`)
      return {
        path: workspacePath,
        category,
        digest: createHash("sha256").update(content).digest("hex"),
        size: content.byteLength,
        modifiedAt: modifiedAt.toISOString(),
        title: path.basename(nativePath),
      }
    },
  )
  const filesystem = {
    async readFile(nativePath: string) {
      const value = values.get(nativePath)
      if (!value) throw new Error(`missing ${nativePath}`)
      return value
    },
    async stat(nativePath: string) {
      const value = values.get(nativePath)
      if (!value) throw new Error(`missing ${nativePath}`)
      return { size: value.byteLength, modifiedAt }
    },
  } as unknown as WorkspaceFilesystem
  return { filesystem, sources, values }
}

describe("attempt-scoped authored data", () => {
  it("loads fixed policy plus newly dropped corpus files from selected refs", async () => {
    const { filesystem, sources } = harness()
    const loaded = await loadDevotionalAttemptAuthoredData({
      filesystem,
      sources,
    })

    expect(loaded.chapters.length).toBeGreaterThan(10)
    expect(loaded.scripture.verses["John.3.16"]).toContain("loved the world")
    expect(loaded.corpora.spurgeon).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "new-source" }),
      ]),
    )
  })

  it("rejects a file edited after its catalog digest was selected", async () => {
    const { filesystem, sources, values } = harness()
    const reader = createAttemptAuthoredDataReader({ filesystem, sources })
    values.set(
      DEVOTIONAL_AUTHORED_PATHS.prompts.slice(1),
      Buffer.from('{"changed":true}'),
    )

    await expect(
      reader.readRequired(DEVOTIONAL_AUTHORED_PATHS.prompts),
    ).rejects.toMatchObject({ code: "source-changed", retryable: true })
  })
})
