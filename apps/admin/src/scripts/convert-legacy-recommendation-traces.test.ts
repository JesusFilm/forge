import { describe, expect, it } from "vitest"
import { parseConversionArguments } from "./convert-legacy-recommendation-traces"

describe("legacy conversion CLI", () => {
  it("defaults to dry run and requires an explicit database confirmation for execution", () => {
    expect(
      parseConversionArguments(["--manifest", "private.json"]).execute,
    ).toBe(false)
    expect(() =>
      parseConversionArguments(["--manifest", "private.json", "--execute"]),
    ).toThrow()
    expect(
      parseConversionArguments([
        "--manifest",
        "private.json",
        "--execute",
        "--confirm-target",
        "hash",
      ]).execute,
    ).toBe(true)
  })
  it.each([
    ["--all"],
    ["--manifest"],
    ["--manifest", "x", "--manifest", "y"],
    ["--freeze", "x", "--execute"],
    ["--manifest", "x", "--max-bytes", "20000000"],
    ["--manifest", "x", "--confirm-target", "h"],
  ])("rejects ambiguous or unbounded arguments %j", (...argv) => {
    expect(() => parseConversionArguments(argv)).toThrow()
  })
  it("freezes reviewed IDs and holds without permitting execution", () => {
    const result = parseConversionArguments([
      "--freeze",
      "pilot.json",
      "--holds",
      "holds.json",
      "--run-ids",
      "ids.json",
      "--created-before",
      "2026-09-14",
      "--max-bytes",
      "4000000",
    ])
    expect(result.execute).toBe(false)
    expect(result.maxBytes).toBe(4_000_000)
  })
})
