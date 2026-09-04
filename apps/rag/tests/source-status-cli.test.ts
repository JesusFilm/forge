/* eslint-disable max-lines -- characterization coverage mirrors the complete lifecycle CLI contract */
/**
 * Unit tests for the deterministic source-status writer (scripts/source-status.ts) —
 * the only sanctioned mutator of docs/source-status.yaml. No fs/argv side effects:
 * we drive the exported pure core over an in-memory yaml Document. Proves the
 * guarantees that stop the /slice agent misusing the file — comment preservation,
 * tool-derived rollup, last_updated bump, and validate-before-write.
 */
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  loadDoc,
  applyMutation,
  validateDoc,
  parseArgv,
  isoDate,
  writeStatusFileAtomically,
  withExclusiveFileLock,
  validateSliceFileReferences,
} from "../scripts/source-status.js"
import { validateSourceStatusRegistry } from "../src/contracts/source-status.js"
import type { Mutation } from "../scripts/source-status.js"

const FIXTURE = `# Source status header — must survive every write.
sources:
  foo:
    name: Foo
    status: in-progress
    languages:
      en:
        status: in-progress
        stages: { acquire: green, ingest: pending, retrieve: pending, evaluate: pending }
    slice_file: docs/slices/foo.md
    last_updated: 2026-01-01
`

const TODAY = "2026-06-29"

describe("applyMutation — set", () => {
  it("derives the rollup status and bumps last_updated when a language completes", () => {
    const doc = loadDoc(FIXTURE)
    const m: Mutation = {
      kind: "set",
      source: "foo",
      lang: "en",
      ops: [
        { op: "stage", stage: "ingest", state: "green" },
        { op: "stage", stage: "retrieve", state: "green" },
        { op: "stage", stage: "evaluate", state: "green" },
        { op: "status", status: "done" },
      ],
    }
    applyMutation(doc, m, TODAY)
    const file = validateDoc(doc)
    expect(file.sources.foo.status).toBe("done") // derived, not hand-set
    expect(file.sources.foo.last_updated).toBe(TODAY)
    expect(doc.toString()).toContain("# Source status header") // comment preserved
  })

  it("refuses (validateDoc throws) when the result violates an invariant", () => {
    const doc = loadDoc(FIXTURE)
    // mark the language done while stages are still pending — an illegal state
    applyMutation(
      doc,
      {
        kind: "set",
        source: "foo",
        lang: "en",
        ops: [{ op: "status", status: "done" }],
      },
      TODAY,
    )
    expect(() => validateDoc(doc)).toThrow()
  })

  it("clears an optional field when given a null value", () => {
    const doc = loadDoc(FIXTURE)
    applyMutation(
      doc,
      {
        kind: "set",
        source: "foo",
        lang: "en",
        ops: [{ op: "note", value: "watch me" }],
      },
      TODAY,
    )
    expect(validateDoc(doc).sources.foo.languages.en.note).toBe("watch me")
    applyMutation(
      doc,
      {
        kind: "set",
        source: "foo",
        lang: "en",
        ops: [{ op: "note", value: null }],
      },
      TODAY,
    )
    expect(validateDoc(doc).sources.foo.languages.en.note).toBeUndefined()
  })

  it("throws on an unknown source or language", () => {
    const doc = loadDoc(FIXTURE)
    expect(() =>
      applyMutation(
        doc,
        { kind: "set", source: "nope", lang: "en", ops: [] },
        TODAY,
      ),
    ).toThrow()
    expect(() =>
      applyMutation(
        doc,
        { kind: "set", source: "foo", lang: "zz", ops: [] },
        TODAY,
      ),
    ).toThrow()
  })
})

describe("canonical registry reconciliation", () => {
  const canonical = [{ key: "foo", languages: ["en"] }]

  it("accepts an exact source key and language projection", () => {
    expect(() =>
      validateSourceStatusRegistry(validateDoc(loadDoc(FIXTURE)), canonical),
    ).not.toThrow()
  })

  it("rejects missing, extra, and language-drifted lifecycle rows", () => {
    const file = validateDoc(loadDoc(FIXTURE))
    expect(() => validateSourceStatusRegistry(file, [])).toThrow(/keys/)
    expect(() =>
      validateSourceStatusRegistry(file, [
        ...canonical,
        { key: "bar", languages: ["en"] },
      ]),
    ).toThrow(/keys/)
    expect(() =>
      validateSourceStatusRegistry(file, [{ key: "foo", languages: ["es"] }]),
    ).toThrow(/languages/)
  })
})

describe("slice file reference validation", () => {
  const packageRoot = "/workspace/apps/rag"

  it("accepts an existing package-local Markdown record", () => {
    expect(() =>
      validateSliceFileReferences(
        validateDoc(loadDoc(FIXTURE)),
        packageRoot,
        (file) => file === `${packageRoot}/docs/slices/foo.md`,
      ),
    ).not.toThrow()
  })

  it("rejects missing, non-Markdown, and package-escaping records", () => {
    const file = validateDoc(loadDoc(FIXTURE))
    expect(() =>
      validateSliceFileReferences(file, packageRoot, () => false),
    ).toThrow(/does not exist/)

    file.sources.foo.slice_file = "docs/slices/foo.txt"
    expect(() =>
      validateSliceFileReferences(file, packageRoot, () => true),
    ).toThrow(/Markdown/)

    file.sources.foo.slice_file = "../../outside.md"
    expect(() =>
      validateSliceFileReferences(file, packageRoot, () => true),
    ).toThrow(/escapes/)
  })
})

describe("applyMutation — add-source / add-lang", () => {
  it("adds a source as a single in-progress language, all stages pending", () => {
    const doc = loadDoc(FIXTURE)
    applyMutation(
      doc,
      {
        kind: "add-source",
        key: "bar",
        name: "Bar",
        lang: "en",
        sliceFile: "docs/slices/bar.md",
      },
      TODAY,
    )
    const file = validateDoc(doc)
    expect(file.sources.bar.status).toBe("in-progress")
    expect(file.sources.bar.languages.en.stages).toEqual({
      acquire: "pending",
      ingest: "pending",
      retrieve: "pending",
      evaluate: "pending",
    })
    expect(file.sources.bar.last_updated).toBe(TODAY)
  })

  it("adds a second language and round-trips through serialization", () => {
    const doc = loadDoc(FIXTURE)
    applyMutation(
      doc,
      {
        kind: "add-source",
        key: "bar",
        name: "Bar",
        lang: "en",
        sliceFile: "docs/slices/bar.md",
      },
      TODAY,
    )
    applyMutation(
      doc,
      { kind: "add-lang", source: "bar", lang: "es", scope: "pilot (1 page)" },
      TODAY,
    )
    const reparsed = validateDoc(loadDoc(doc.toString()))
    expect(Object.keys(reparsed.sources.bar.languages).sort()).toEqual([
      "en",
      "es",
    ])
    expect(reparsed.sources.bar.languages.es.scope).toBe("pilot (1 page)")
  })

  it("refuses to add a duplicate source or an existing language", () => {
    const doc = loadDoc(FIXTURE)
    expect(() =>
      applyMutation(
        doc,
        {
          kind: "add-source",
          key: "foo",
          name: "Foo",
          lang: "en",
          sliceFile: "x",
        },
        TODAY,
      ),
    ).toThrow()
    expect(() =>
      applyMutation(
        doc,
        { kind: "add-lang", source: "foo", lang: "en" },
        TODAY,
      ),
    ).toThrow()
  })
})

describe("applyMutation — remove-source", () => {
  it("removes a source entirely, leaving the others and the header intact", () => {
    const doc = loadDoc(FIXTURE)
    applyMutation(
      doc,
      {
        kind: "add-source",
        key: "bar",
        name: "Bar",
        lang: "en",
        sliceFile: "docs/slices/bar.md",
      },
      TODAY,
    )
    applyMutation(doc, { kind: "remove-source", key: "foo" }, TODAY)
    const reparsed = validateDoc(loadDoc(doc.toString()))
    expect(Object.keys(reparsed.sources)).toEqual(["bar"])
    expect(doc.toString()).toContain("must survive every write") // header comment preserved
  })

  it("throws on an unknown source key (loud, not a silent no-op)", () => {
    const doc = loadDoc(FIXTURE)
    expect(() =>
      applyMutation(doc, { kind: "remove-source", key: "nope" }, TODAY),
    ).toThrow()
  })
})

describe("parseArgv", () => {
  it("parses a multi-op set", () => {
    expect(
      parseArgv([
        "set",
        "--source",
        "foo",
        "--lang",
        "en",
        "--stage",
        "acquire=green",
        "--status",
        "done",
      ]),
    ).toEqual({
      kind: "set",
      source: "foo",
      lang: "en",
      ops: [
        { op: "stage", stage: "acquire", state: "green" },
        { op: "status", status: "done" },
      ],
    })
  })

  it("parses --clear-blocker as a null blocker op", () => {
    expect(
      parseArgv(["set", "--source", "foo", "--lang", "en", "--clear-blocker"]),
    ).toEqual({
      kind: "set",
      source: "foo",
      lang: "en",
      ops: [{ op: "blocker", value: null }],
    })
  })

  it("parses add-source, add-lang, and check", () => {
    expect(
      parseArgv([
        "add-source",
        "--key",
        "bar",
        "--name",
        "Bar",
        "--lang",
        "en",
        "--slice-file",
        "docs/slices/bar.md",
      ]),
    ).toEqual({
      kind: "add-source",
      key: "bar",
      name: "Bar",
      lang: "en",
      sliceFile: "docs/slices/bar.md",
    })
    expect(
      parseArgv([
        "add-lang",
        "--source",
        "bar",
        "--lang",
        "es",
        "--scope",
        "pilot",
      ]),
    ).toEqual({
      kind: "add-lang",
      source: "bar",
      lang: "es",
      scope: "pilot",
    })
    expect(parseArgv(["remove-source", "--key", "bar"])).toEqual({
      kind: "remove-source",
      key: "bar",
    })
    expect(parseArgv(["check"])).toEqual({ kind: "check" })
  })

  it("rejects remove-source with a missing key or stray positional", () => {
    expect(() => parseArgv(["remove-source"])).toThrow()
    expect(() => parseArgv(["remove-source", "--key", "bar", "oops"])).toThrow()
  })

  it("rejects an invalid stage state or status enum", () => {
    expect(() =>
      parseArgv([
        "set",
        "--source",
        "foo",
        "--lang",
        "en",
        "--stage",
        "acquire=blue",
      ]),
    ).toThrow()
    expect(() =>
      parseArgv([
        "set",
        "--source",
        "foo",
        "--lang",
        "en",
        "--status",
        "almost",
      ]),
    ).toThrow()
  })

  // CodeRabbit #1 + #2: the "invalid input exits non-zero" contract must hold for
  // malformed add-source/add-lang flags and a no-op set, not just bad enums.
  it("rejects a flag with no value (add-lang --scope with nothing)", () => {
    expect(() =>
      parseArgv(["add-lang", "--source", "foo", "--lang", "es", "--scope"]),
    ).toThrow()
  })

  it("rejects an unknown / misspelled flag (add-lang --scpoe)", () => {
    expect(() =>
      parseArgv([
        "add-lang",
        "--source",
        "foo",
        "--lang",
        "es",
        "--scpoe",
        "pilot",
      ]),
    ).toThrow()
  })

  it("rejects a stray positional token (add-source)", () => {
    expect(() =>
      parseArgv([
        "add-source",
        "--key",
        "k",
        "--name",
        "n",
        "--lang",
        "en",
        "--slice-file",
        "f",
        "oops",
      ]),
    ).toThrow()
  })

  it("rejects an empty set — no mutation flags would be a timestamp-only write", () => {
    expect(() =>
      parseArgv(["set", "--source", "foo", "--lang", "en"]),
    ).toThrow()
  })
})

describe("isoDate — UTC, not local (PR #49 review: cross-timezone operators)", () => {
  it("formats the UTC calendar date regardless of the input's offset", () => {
    // 2026-06-29 09:00 +13:00 (NZ) is 2026-06-28 20:00 UTC — the date must be the UTC one
    expect(isoDate(new Date("2026-06-29T09:00:00+13:00"))).toBe("2026-06-28")
    expect(isoDate(new Date("2026-01-15T12:00:00Z"))).toBe("2026-01-15")
  })
})

describe("writeStatusFileAtomically", () => {
  it("renames a complete temporary file over the destination", async () => {
    const calls: string[] = []
    await writeStatusFileAtomically("status.yaml", "next", "attempt", {
      writeFile: async (file, contents, options) => {
        calls.push(`write:${file}:${contents}:${options.flag}`)
      },
      rename: async (from, to) => {
        calls.push(`rename:${from}:${to}`)
      },
      rm: async () => undefined,
    })
    expect(calls).toEqual([
      "write:status.yaml.attempt.tmp:next:wx",
      "rename:status.yaml.attempt.tmp:status.yaml",
    ])
  })

  it("never replaces the destination when the temporary write fails", async () => {
    let renamed = false
    let cleaned = false
    await expect(
      writeStatusFileAtomically("status.yaml", "next", "attempt", {
        writeFile: async () => {
          throw new Error("disk full")
        },
        rename: async () => {
          renamed = true
        },
        rm: async () => {
          cleaned = true
        },
      }),
    ).rejects.toThrow("disk full")
    expect(renamed).toBe(false)
    expect(cleaned).toBe(true)
  })
})

describe("withExclusiveFileLock", () => {
  it("serializes concurrent mutations before either caller reads", async () => {
    const events: string[] = []
    let releaseFirst!: () => void
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = withExclusiveFileLock("status.yaml", async () => {
      events.push("first:read")
      await firstMayFinish
      events.push("first:write")
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const second = withExclusiveFileLock("status.yaml", async () => {
      events.push("second:read")
      events.push("second:write")
    })

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(events).toEqual(["first:read"])
    releaseFirst()
    await Promise.all([first, second])
    expect(events).toEqual([
      "first:read",
      "first:write",
      "second:read",
      "second:write",
    ])
  })

  it("removes the sibling lock when the mutation fails", async () => {
    await expect(
      withExclusiveFileLock("status-cleanup.yaml", async () => {
        throw new Error("validation failed")
      }),
    ).rejects.toThrow("validation failed")

    await expect(
      withExclusiveFileLock("status-cleanup.yaml", async () => "recovered"),
    ).resolves.toBe("recovered")
  })

  it("times out with actionable guidance when a fresh lock already exists", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "source-status-lock-"))
    const file = path.join(directory, "status.yaml")
    const lock = `${file}.lock`
    await writeFile(lock, "fresh owner")
    try {
      await expect(
        withExclusiveFileLock(file, async () => undefined, {
          retryMs: 1,
          timeoutMs: 5,
          staleMs: 60_000,
        }),
      ).rejects.toThrow(/timed out.*remove the stale lock and retry/)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("recovers an aged orphan lock before running the mutation", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "source-status-lock-"))
    const file = path.join(directory, "status.yaml")
    const lock = `${file}.lock`
    await writeFile(lock, "orphaned")
    const old = new Date(Date.now() - 120_000)
    await utimes(lock, old, old)
    try {
      await expect(
        withExclusiveFileLock(file, async () => "recovered", {
          retryMs: 1,
          timeoutMs: 20,
          staleMs: 60_000,
        }),
      ).resolves.toBe("recovered")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("recovers an abandoned transition guard", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "source-status-lock-"))
    const file = path.join(directory, "status.yaml")
    const guard = `${file}.lock.guard`
    await mkdir(guard)
    const old = new Date(Date.now() - 120_000)
    await utimes(guard, old, old)
    try {
      await expect(
        withExclusiveFileLock(file, async () => "recovered", {
          retryMs: 1,
          timeoutMs: 20,
          staleMs: 60_000,
        }),
      ).resolves.toBe("recovered")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("does not recover an aged transition guard owned by a live process", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "source-status-lock-"))
    const file = path.join(directory, "status.yaml")
    const guard = `${file}.lock.guard`
    await mkdir(guard)
    await writeFile(
      path.join(guard, "owner"),
      JSON.stringify({
        token: "live-guard",
        pid: process.pid,
        createdAt: "old",
      }),
    )
    const old = new Date(Date.now() - 120_000)
    await utimes(guard, old, old)
    try {
      await expect(
        withExclusiveFileLock(file, async () => undefined, {
          retryMs: 1,
          timeoutMs: 5,
          staleMs: 60_000,
        }),
      ).rejects.toThrow(/timed out waiting for transition guard/)
      expect(
        JSON.parse(await readFile(path.join(guard, "owner"), "utf8")),
      ).toMatchObject({
        token: "live-guard",
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("does not quarantine a successor acquired after the stale read", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "source-status-lock-"))
    const file = path.join(directory, "status.yaml")
    const lock = `${file}.lock`
    await writeFile(
      lock,
      JSON.stringify({ token: "orphan", pid: 2_147_483_647, createdAt: "old" }),
    )
    const old = new Date(Date.now() - 120_000)
    await utimes(lock, old, old)
    let replaced = false
    let ran = false
    try {
      await expect(
        withExclusiveFileLock(
          file,
          async () => {
            ran = true
          },
          {
            retryMs: 1,
            timeoutMs: 10,
            staleMs: 60_000,
            afterStaleRead: async () => {
              if (replaced) return
              replaced = true
              await rm(lock)
              await writeFile(
                lock,
                JSON.stringify({
                  token: "successor",
                  pid: process.pid,
                  createdAt: new Date().toISOString(),
                }),
              )
            },
          },
        ),
      ).rejects.toThrow(/timed out/)
      expect(ran).toBe(false)
      expect(JSON.parse(await readFile(lock, "utf8"))).toMatchObject({
        token: "successor",
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
