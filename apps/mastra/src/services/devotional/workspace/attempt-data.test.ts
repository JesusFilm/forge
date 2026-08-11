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

function harness(overrides: Record<string, string> = {}) {
  const values = new Map<string, Buffer>()
  for (const workspacePath of Object.values(DEVOTIONAL_AUTHORED_PATHS)) {
    values.set(workspacePath.slice(1), Buffer.from(fixture(workspacePath)))
  }
  values.set(
    "inputs/reflections/new-source.md",
    Buffer.from("Grace meets a fearful heart with steady hope."),
  )
  for (const [nativePath, content] of Object.entries(overrides)) {
    values.set(nativePath, Buffer.from(content))
  }
  values.set(
    "inputs/scripture/john/3-16.md",
    Buffer.from(
      "For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life.",
    ),
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

  it("loads a canonical content-only scripture source without a JSON corpus", async () => {
    const { filesystem, sources, values } = harness()
    values.delete("inputs/scripture/web-bible.json")
    const selected = sources.filter(
      ({ path: sourcePath }) =>
        sourcePath !== "/inputs/scripture/web-bible.json",
    )

    const loaded = await loadDevotionalAttemptAuthoredData({
      filesystem,
      sources: selected,
    })

    expect(loaded.scripture.verses).toEqual({
      "John.3.16":
        "For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life.",
    })
  })

  it("loads generated corpus envelopes through verified Workspace reads", async () => {
    const { filesystem, sources } = harness({
      "inputs/scripture/web-bible.json": JSON.stringify({
        translation: "World English Bible",
        abbreviation: "WEB",
        license: "public-domain",
        sourceUrl: "https://api.getbible.net/v2/web",
        books: ["John"],
        verseCount: 1,
        verses: { "John.3.16": "For God so loved the world." },
      }),
      "inputs/reflections/ryle-matthew.json": JSON.stringify({
        source: "J.C. Ryle, Expository Thoughts",
        sourceUrl: "https://ccel.org/ccel/ryle/matthew.xml",
        license: "public-domain",
        ingestedFrom: "CCEL ThML",
        count: 1,
        entries: [
          {
            id: "Matt.3.1-Matt.3.2",
            book: "Matthew",
            chapter: 3,
            reference: "Matthew 3:1-2",
            osisRef: "Matt.3.1-Matt.3.2",
            text: "Repent and prepare.",
            source: "J.C. Ryle, Expository Thoughts",
          },
        ],
      }),
    })

    const loaded = await loadDevotionalAttemptAuthoredData({
      filesystem,
      sources,
    })

    expect(loaded.scripture.verses["John.3.16"]).toBe(
      "For God so loved the world.",
    )
    expect(loaded.corpora.ryleMatthew).toContainEqual(
      expect.objectContaining({
        osisRef: "Matt.3.1-Matt.3.2",
        text: "Repent and prepare.",
      }),
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
