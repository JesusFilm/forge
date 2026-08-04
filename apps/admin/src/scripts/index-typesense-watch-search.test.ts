import { describe, expect, it } from "vitest"
import { parseTypesenseWatchSearchIndexArgs } from "./index-typesense-watch-search"

describe("Typesense Watch Search index CLI", () => {
  it("reuses transcripts when no rebuild flag is supplied", () => {
    expect(parseTypesenseWatchSearchIndexArgs([])).toEqual({
      transcriptStrategy: "reuse",
    })
  })

  it("rebuilds transcripts only for the exact documented flag", () => {
    expect(
      parseTypesenseWatchSearchIndexArgs(["--rebuild-transcripts"]),
    ).toEqual({ transcriptStrategy: "rebuild" })
  })

  it.each([
    { argv: ["--rebuild-transcript"] },
    { argv: ["--rebuild-transcripts=true"] },
    { argv: ["--rebuild-transcripts", "extra"] },
  ])(
    "rejects unknown arguments instead of silently reusing: $argv",
    ({ argv }) => {
      expect(() => parseTypesenseWatchSearchIndexArgs(argv)).toThrow(
        "Unknown Typesense Watch Search index argument",
      )
    },
  )
})
