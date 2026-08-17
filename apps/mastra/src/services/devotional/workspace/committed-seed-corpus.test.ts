import { readFile, readdir, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  matchReflection,
  parseReflectionDocument,
  selectReflection,
  type ReflectionCorpora,
  type ReflectionEntry,
} from "../reflection-corpus"
import { lookupVerse, parseWebBibleDocument } from "../web-bible"
import { DEVOTIONAL_INVENTORY_DEFAULTS } from "./inventory"
import { validateWorkspaceDocument } from "./schemas"

/**
 * Contract test over the COMMITTED corpus bytes, not over a fixture.
 *
 * `devotional-workspace/` is the seed manifest the migration copies into the
 * S3-backed Workspace verbatim — it validates the manifest and the ledger, but
 * never authored-input CONTENT. So the first thing that reads these documents
 * is reconcile, in production, and an invalid reflections file is EXCLUDED and
 * reported rather than rejected loudly: the failure surfaces as "no valid
 * reflection source was selected" at generation time, which reads like missing
 * data rather than malformed data. This test is the only place that catches it
 * before then, which is why it runs the real reconcile-time validator over the
 * real files instead of asserting a hand-written shape.
 *
 * It was written after the ingest scripts were found emitting a metadata
 * envelope (`source`/`sourceUrl`/`license`/`ingestedFrom`/`count`, per-entry
 * `id`) that both `.strict()` schemas reject.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WORKSPACE = path.resolve(HERE, "../../../../devotional-workspace")
const REFLECTIONS = path.join(WORKSPACE, "inputs/reflections")
const SCRIPTURE = path.join(WORKSPACE, "inputs/scripture")

/** Reconcile skips exactly this filename; everything else is a source. */
const isDocumentation = (name: string) => name.toLowerCase() === "readme.md"

async function corpusFiles(dir: string): Promise<string[]> {
  const names = await readdir(dir)
  return names.filter((n) => n.endsWith(".json") && !isDocumentation(n)).sort()
}

describe("committed Workspace seed corpus", () => {
  it("ships the reflection sources the pipeline needs", async () => {
    // Pinned so a deletion fails here rather than at generation time. Matthew
    // comes from Ryle and Mark/Luke/John from Matthew Henry; Henry is split per
    // book to stay well under the per-file inventory limit.
    expect(await corpusFiles(REFLECTIONS)).toEqual([
      "matthew-henry-john.json",
      "matthew-henry-luke.json",
      "matthew-henry-mark.json",
      "ryle-matthew.json",
    ])
    expect(await corpusFiles(SCRIPTURE)).toEqual(["web-bible.json"])
  })

  it("passes the reconcile-time validator for every committed source", async () => {
    const cases = [
      ...(await corpusFiles(REFLECTIONS)).map((name) => ({
        category: "reflections" as const,
        file: path.join(REFLECTIONS, name),
        workspacePath: `/inputs/reflections/${name}`,
      })),
      ...(await corpusFiles(SCRIPTURE)).map((name) => ({
        category: "scripture" as const,
        file: path.join(SCRIPTURE, name),
        workspacePath: `/inputs/scripture/${name}`,
      })),
    ]
    expect(cases.length).toBeGreaterThan(0)

    for (const { category, file, workspacePath } of cases) {
      const content = await readFile(file, "utf8")
      expect(() =>
        validateWorkspaceDocument({ path: workspacePath, category, content }),
      ).not.toThrow()
    }
  })

  it("keeps every source inside the per-file inventory limit", async () => {
    for (const dir of [REFLECTIONS, SCRIPTURE]) {
      for (const name of await corpusFiles(dir)) {
        const { size } = await stat(path.join(dir, name))
        expect(size).toBeLessThanOrEqual(
          DEVOTIONAL_INVENTORY_DEFAULTS.maxTextFileBytes,
        )
      }
    }
  })

  it("holds the book coverage reflection routing depends on", async () => {
    // `addReflection` is module-private, and it routes on the osisRef book
    // prefix BEFORE the filename. These are the properties of the committed
    // bytes that make that routing land correctly.
    const booksIn = (entries: ReflectionEntry[]) =>
      [...new Set(entries.map((e) => (e.osisRef ?? "").split(".")[0]))].sort()

    const ryle = await loadReflections("ryle-matthew.json")
    expect(booksIn(ryle)).toEqual(["Matt"])

    for (const [name, book] of [
      ["matthew-henry-mark.json", "Mark"],
      ["matthew-henry-luke.json", "Luke"],
      ["matthew-henry-john.json", "John"],
    ] as const) {
      const entries = await loadReflections(name)
      expect(booksIn(entries)).toEqual([book])
      // Whole-chapter granularity: `matchReflection` looks the Henry side up by
      // an exact `Book.Chapter` osisRef, so a verse-level ref would never match.
      expect(
        entries.every((e) => /^[A-Za-z]+\.\d+$/u.test(e.osisRef ?? "")),
      ).toBe(true)
    }
  })

  it("resolves scripture and a reflection for a real passage", async () => {
    const corpora = await loadCorpora()

    // Luke 19 (Zacchaeus) — Matthew Henry via the whole-chapter lookup.
    const luke = matchReflection("Luke.19.1-Luke.19.10", corpora)
    expect(luke?.osisRef).toBe("Luke.19")
    expect(luke?.source).toContain("Matthew Henry")

    // Matthew — Ryle, via verse-range coverage.
    const matt = matchReflection("Matt.5.1-Matt.5.12", corpora)
    expect(matt?.source).toContain("Ryle")

    // The rotating selector always returns something with these corpora, in
    // both flavours, even though no thematic source is committed yet.
    for (const sequence of [0, 1]) {
      const selected = selectReflection(
        {
          passageOsis: "Luke.19.1-Luke.19.10",
          reference: "Luke 19:1-10",
          themes: ["seeking", "grace"],
          sequence,
        },
        corpora,
      )
      expect(selected?.text.length ?? 0).toBeGreaterThan(0)
    }

    const bible = parseWebBibleDocument({
      path: "/inputs/scripture/web-bible.json",
      content: await readFile(path.join(SCRIPTURE, "web-bible.json"), "utf8"),
    })
    // A placeholder would satisfy the schema, so assert real coverage: an exact
    // verse, a joined range, and one verse from each ingested book.
    expect(lookupVerse("Luke 19:5", bible.verses)).toContain("Zacchaeus")
    expect(
      lookupVerse("Luke 19:1-10", bible.verses)?.length ?? 0,
    ).toBeGreaterThan(500)
    for (const reference of [
      "Matthew 5:3",
      "Mark 1:1",
      "Luke 2:7",
      "John 1:1",
      "Acts 1:8",
    ]) {
      expect(lookupVerse(reference, bible.verses)).toBeTruthy()
    }
    expect(Object.keys(bible.verses).length).toBeGreaterThan(4_000)
  })
})

async function loadReflections(name: string): Promise<ReflectionEntry[]> {
  const file = path.join(REFLECTIONS, name)
  return parseReflectionDocument({
    path: `/inputs/reflections/${name}`,
    content: await readFile(file, "utf8"),
  })
}

async function loadCorpora(): Promise<ReflectionCorpora> {
  const [matt, mark, luke, john] = await Promise.all([
    loadReflections("ryle-matthew.json"),
    loadReflections("matthew-henry-mark.json"),
    loadReflections("matthew-henry-luke.json"),
    loadReflections("matthew-henry-john.json"),
  ])
  return {
    ryleMatthew: matt,
    matthewHenry: [...mark, ...luke, ...john],
    spurgeon: [],
  }
}
