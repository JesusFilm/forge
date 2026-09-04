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
      "ryle-luke.json",
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

  it("holds the book coverage the commentary pool depends on", async () => {
    // `matchReflection` filters the pool by the entry's own book and then ranks
    // by span, so these are the properties of the committed bytes that make a
    // passage resolve at all, and resolve to the tighter source.
    const booksIn = (entries: ReflectionEntry[]) =>
      [...new Set(entries.map((e) => (e.osisRef ?? "").split(".")[0]))].sort()

    expect(booksIn(await loadReflections("ryle-matthew.json"))).toEqual([
      "Matt",
    ])
    expect(booksIn(await loadReflections("ryle-luke.json"))).toEqual(["Luke"])

    for (const [name, book] of [
      ["matthew-henry-mark.json", "Mark"],
      ["matthew-henry-luke.json", "Luke"],
      ["matthew-henry-john.json", "John"],
    ] as const) {
      const entries = await loadReflections(name)
      expect(booksIn(entries)).toEqual([book])
      // Henry is whole-chapter (`Luke.19`), which is what makes him the FALLBACK
      // under a section-granular source rather than a competitor.
      expect(
        entries.every((e) => /^[A-Za-z]+\.\d+$/u.test(e.osisRef ?? "")),
      ).toBe(true)
    }

    // Ryle is per-pericope (`Luke.19.1-Luke.19.10`) — a verse range, always.
    for (const name of ["ryle-matthew.json", "ryle-luke.json"] as const) {
      const entries = await loadReflections(name)
      expect(
        entries.every((e) =>
          /^[A-Za-z]+\.\d+\.\d+(-[A-Za-z]+\.\d+\.\d+)?$/u.test(e.osisRef ?? ""),
        ),
        name,
      ).toBe(true)
    }
  })

  it("resolves scripture and a reflection for a real passage", async () => {
    const corpora = await loadCorpora()

    // Luke 19 (Zacchaeus): both Ryle's pericope and Henry's whole chapter cover
    // it, and the pericope must win — that preference is the point of pooling.
    const luke = matchReflection("Luke.19.1-Luke.19.10", corpora)
    expect(luke?.osisRef).toBe("Luke.19.1-Luke.19.10")
    expect(luke?.source).toContain("Ryle")
    expect(luke?.text.length).toBeLessThan(20_000)

    // Where Ryle has no section, Henry still answers.
    expect(matchReflection("Mark.4.35-Mark.4.41", corpora)?.source).toContain(
      "Matthew Henry",
    )

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
  // Alphabetical, exactly as reconcile lists the folder — so Henry precedes
  // Ryle in the pool and any document-order preference would pick the wrong one.
  const files = [
    "matthew-henry-john.json",
    "matthew-henry-luke.json",
    "matthew-henry-mark.json",
    "ryle-luke.json",
    "ryle-matthew.json",
  ]
  const loaded = await Promise.all(files.map((name) => loadReflections(name)))
  return { commentary: loaded.flat(), spurgeon: [] }
}
