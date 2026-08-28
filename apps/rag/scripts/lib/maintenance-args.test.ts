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
    ).toMatchObject({ source: "cru", concurrency: 4, apply: true })
    expect(() => parseIndexArgs(["--concurrency", "5"])).toThrow(/1\.\.4/)
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
  })
})
