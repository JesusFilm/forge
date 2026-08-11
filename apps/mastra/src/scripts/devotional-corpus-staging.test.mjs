import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  corpusStagingPath,
  fetchCorpusText,
  resolveWorkspaceStagingRoot,
  writeCorpusDocument,
} from "./devotional-corpus-staging.mjs"

const run = promisify(execFile)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const GENERATOR_SCRIPTS = [
  "ingest-matthew-henry-gospels.mjs",
  "ingest-ryle-matthew.mjs",
  "ingest-spurgeon-morning-evening.mjs",
  "ingest-web-bible.mjs",
]

describe("devotional corpus staging", () => {
  it("requires exactly one explicit Workspace root", () => {
    expect(() => resolveWorkspaceStagingRoot([])).toThrow(/workspace-root/u)
    expect(() =>
      resolveWorkspaceStagingRoot([
        "--workspace-root=/tmp/one",
        "--workspace-root=/tmp/two",
      ]),
    ).toThrow(/exactly one/u)
  })

  it("allows only canonical corpus categories and safe JSON filenames", () => {
    expect(
      corpusStagingPath("/tmp/devotional-stage", "scripture", "web-bible.json"),
    ).toBe("/tmp/devotional-stage/inputs/scripture/web-bible.json")
    expect(() =>
      corpusStagingPath("/tmp/devotional-stage", "media", "video.json"),
    ).toThrow(/unsupported/u)
    expect(() =>
      corpusStagingPath(
        "/tmp/devotional-stage",
        "reflections",
        "../escape.json",
      ),
    ).toThrow(/unsafe/u)
  })

  it("writes create-only JSON beneath the canonical input category", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "devotional-corpus-"),
    )

    try {
      const outputPath = await writeCorpusDocument({
        workspaceRoot,
        category: "reflections",
        filename: "source.json",
        document: { entries: [{ text: "Grace" }] },
      })

      await expect(readFile(outputPath, "utf8")).resolves.toBe(
        '{\n  "entries": [\n    {\n      "text": "Grace"\n    }\n  ]\n}\n',
      )
      await expect(
        writeCorpusDocument({
          workspaceRoot,
          category: "reflections",
          filename: "source.json",
          document: { entries: [] },
        }),
      ).rejects.toMatchObject({ code: "EEXIST" })
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it("rejects resolved output paths outside the Workspace root", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "devotional-corpus-root-"),
    )
    const outsideRoot = await mkdtemp(
      path.join(tmpdir(), "devotional-corpus-outside-"),
    )

    try {
      await mkdir(path.join(workspaceRoot, "inputs"))
      await symlink(
        outsideRoot,
        path.join(workspaceRoot, "inputs", "reflections"),
      )
      await expect(
        writeCorpusDocument({
          workspaceRoot,
          category: "reflections",
          filename: "source.json",
          document: { entries: [] },
        }),
      ).rejects.toMatchObject({ code: "unsafe-output-path" })
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
      await rm(outsideRoot, { recursive: true, force: true })
    }
  })

  it("keeps migration staging outside the source repository", async () => {
    const workspaceRoot = path.join(HERE, ".devotional-corpus-test")
    try {
      await expect(
        writeCorpusDocument({
          workspaceRoot,
          category: "scripture",
          filename: "source.json",
          document: { verses: {} },
        }),
      ).rejects.toMatchObject({ code: "repository-workspace-root" })
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it("makes every generator require an explicit Workspace root before I/O", async () => {
    for (const script of GENERATOR_SCRIPTS) {
      await expect(
        run(process.execPath, [path.join(HERE, script)]),
      ).rejects.toMatchObject({
        stderr: expect.stringMatching(/workspace-root/u),
      })
    }
  })

  it("aborts an upstream corpus request at its deadline", async () => {
    const neverResponds = (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        })
      })

    await expect(
      fetchCorpusText("https://example.test/corpus", {
        fetchImpl: neverResponds,
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ code: "upstream-request-timeout" })
  })
})
