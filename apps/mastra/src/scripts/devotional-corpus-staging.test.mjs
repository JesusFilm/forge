import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  corpusStagingPath,
  resolveWorkspaceStagingRoot,
  writeCorpusDocument,
} from "./devotional-corpus-staging.mjs"

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
})
