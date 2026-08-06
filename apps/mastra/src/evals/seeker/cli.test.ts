import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { csv, flag, loadFixtures, runRequiresFixtures } from "./cli"

describe("flag", () => {
  it("returns the value of a --name=value argument and undefined otherwise", () => {
    expect(flag(["--out=/tmp/x.json", "--limit=3"], "out")).toBe("/tmp/x.json")
    expect(flag(["--out=/tmp/x.json"], "limit")).toBeUndefined()
    // Prefix discipline: `--outfile=` must not satisfy `--out=`.
    expect(flag(["--outfile=/tmp/y.json"], "out")).toBeUndefined()
  })
})

describe("csv", () => {
  it("splits, trims, and drops empties", () => {
    expect(csv("a, b ,,c")).toEqual(["a", "b", "c"])
    expect(csv(undefined)).toEqual([])
    expect(csv("")).toEqual([])
  })
})

describe("loadFixtures — the ONE fail-closed loader (decision 2026-08-04 #9)", () => {
  it("throws a distinct error when the file is absent", async () => {
    await expect(
      loadFixtures(
        fileURLToPath(new URL("./no-such-fixtures.json", import.meta.url)),
      ),
    ).rejects.toThrow(/fixtures file not found/)
  })

  it("throws a distinct error when the file is not valid JSON", async () => {
    await expect(
      loadFixtures(fileURLToPath(new URL("./cli.ts", import.meta.url))),
    ).rejects.toThrow(/not valid JSON/)
  })

  it("throws when the file is valid JSON of the wrong kind", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seeker-cli-test-"))
    const wrongKind = join(dir, "wrong-kind.json")
    await writeFile(wrongKind, JSON.stringify({ kind: "something-else" }))
    await expect(loadFixtures(wrongKind)).rejects.toThrow(
      /not a chat-eval RAG fixture file/,
    )
  })

  it("loads the committed fixture file", async () => {
    const file = await loadFixtures(
      fileURLToPath(new URL("./fixtures/rag-fixtures.json", import.meta.url)),
    )
    expect(file.kind).toBe("chat-eval-rag-fixtures")
    expect(file.fixtures.length).toBeGreaterThan(0)
  })
})

describe("runRequiresFixtures — mode-aware requirement (finding #12)", () => {
  it("requires fixtures for fixture-world runs; only mode 'none' proceeds without", () => {
    expect(
      runRequiresFixtures({ mode: "fixtures", corpusSha256: "c", topK: 5 }),
    ).toBe(true)
    expect(
      runRequiresFixtures({ mode: "tool-loop", corpusSha256: "c", topK: 5 }),
    ).toBe(true)
    expect(runRequiresFixtures({ mode: "none" })).toBe(false)
    expect(runRequiresFixtures(undefined)).toBe(false)
  })
})
