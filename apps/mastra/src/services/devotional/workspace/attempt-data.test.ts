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

function harness(extra: Record<string, string> = {}) {
  const values = new Map<string, Buffer>()
  for (const workspacePath of Object.values(DEVOTIONAL_AUTHORED_PATHS)) {
    values.set(workspacePath.slice(1), Buffer.from(fixture(workspacePath)))
  }
  values.set(
    "inputs/reflections/new-source.md",
    Buffer.from("Grace meets a fearful heart with steady hope."),
  )
  for (const [nativePath, content] of Object.entries(extra)) {
    values.set(nativePath, Buffer.from(content))
  }
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
  it("keeps a theme-keyed source out of the passage-matched pool", async () => {
    // Spurgeon's entries are anchored to their OWN verse, so pooling them with
    // commentary would make a Morning-and-Evening meditation selectable as a
    // commentary on whatever passage that verse belongs to — and presented as
    // `flavor: "commentary"`. Routing must key on the source, not on the mere
    // presence of an osisRef.
    const { filesystem, sources } = harness({
      "inputs/reflections/spurgeon-morning-evening.json": JSON.stringify({
        entries: [
          {
            source: "Charles Spurgeon, Morning and Evening",
            reference: "Luke 19:10",
            osisRef: "Luke.19.10",
            verse: "For the Son of man is come to seek and to save",
            text: "A thematic meditation on seeking and being sought.",
          },
        ],
      }),
    })

    const loaded = await loadDevotionalAttemptAuthoredData({
      filesystem,
      sources,
    })

    const inCommentary = loaded.corpora.commentary.filter((entry) =>
      entry.source.includes("Spurgeon"),
    )
    expect(inCommentary).toEqual([])
    expect(
      loaded.corpora.spurgeon.some((entry) =>
        entry.source.includes("Spurgeon"),
      ),
    ).toBe(true)
  })

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
