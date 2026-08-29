import { describe, expect, it } from "vitest"

import {
  parseAcquireArgs,
  parseIndexArgs,
  parseLanguageArgs,
} from "./maintenance-args.js"

describe("maintenance command arguments", () => {
  it("requires an explicit acquire scope and defaults production-safe flags", () => {
    expect(parseAcquireArgs(["--source", "cru"])).toEqual({
      all: false,
      source: "cru",
      dryRun: true,
      resume: false,
      apply: false,
    })
    expect(() => parseAcquireArgs(["--all", "--source", "cru"])).toThrow(
      /exactly one/,
    )
  })

  it("bounds index concurrency and preserves source/force controls", () => {
    expect(
      parseIndexArgs(["--source", "cru", "--concurrency", "4", "--apply"]),
    ).toMatchObject({ all: false, source: "cru", concurrency: 4, apply: true })
    expect(() => parseIndexArgs(["--all", "--concurrency", "5"])).toThrow(
      /1\.\.4/,
    )
    expect(() => parseIndexArgs([])).toThrow(/exactly one/)
    expect(() => parseIndexArgs(["--all", "--source", "cru"])).toThrow(
      /exactly one/,
    )
    expect(() => parseIndexArgs(["--all", "--limit"])).toThrow(
      /requires a value/,
    )
    expect(() => parseIndexArgs(["--all", "--wat"])).toThrow(/unknown flag/)
    expect(() => parseIndexArgs(["--all", "--all"])).toThrow(
      /only be specified once/,
    )
    expect(() =>
      parseIndexArgs(["--source", "cru", "--force-all", "--limit", "10"]),
    ).toThrow(/cannot be combined/)
  })

  it("makes sweep and revert read-only unless apply is explicit", () => {
    expect(parseLanguageArgs(["--source", "cru"])).toMatchObject({
      kind: "sweep",
      source: "cru",
      apply: false,
      concurrency: 3,
    })
    expect(parseLanguageArgs(["--revert", "changes.jsonl"])).toEqual({
      kind: "revert",
      changelog: "changes.jsonl",
      apply: false,
    })
    expect(() =>
      parseLanguageArgs(["--revert", "changes.jsonl", "--source", "cru"]),
    ).toThrow(/cannot be combined/)
    expect(
      parseLanguageArgs([
        "--source",
        "cru",
        "--mode",
        "full",
        "--after-id",
        "00000000-0000-0000-0000-000000000001",
      ]),
    ).toMatchObject({
      kind: "sweep",
      afterId: "00000000-0000-0000-0000-000000000001",
    })
    expect(() =>
      parseLanguageArgs([
        "--all",
        "--after-id",
        "00000000-0000-0000-0000-000000000001",
      ]),
    ).toThrow(/source-scoped/)
  })
})
