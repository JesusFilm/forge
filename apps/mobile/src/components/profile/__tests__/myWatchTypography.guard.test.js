// Plain JS, like the other guard suites: the RN tsconfig has no Node types.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// A fixed `fontSize: <number>` skips useTypography's screen-width scaling.
// This is an ENUMERATION, not a sweep: add a row when a file joins My Watch.
const MOBILE_ROOT = path.join(__dirname, "..", "..", "..", "..")

const FILES = [
  "app/account.tsx",
  "app/downloads.tsx",
  "app/more.tsx",
  "src/components/library/DeleteConfirmSheet.tsx",
  "src/components/library/DownloadRow.tsx",
  "src/components/library/LibraryDownloads.tsx",
  "src/components/library/LibraryEmptyState.tsx",
  "src/components/library/SelectionActionBar.tsx",
  "src/components/library/SeriesGroupCard.tsx",
  "src/components/profile/DeleteAccountFlow.tsx",
  "src/components/profile/DownloadRail.tsx",
  "src/components/profile/DownloadTile.tsx",
  "src/components/profile/MyWatchHeader.tsx",
  "src/components/profile/MyWatchScreen.tsx",
  "src/components/ui/ScreenTopBar.tsx",
]

// SeriesGroupCard's "›" chevron is a glyph sized like an icon, not text.
const ALLOWED_FIXED_SIZES = {
  "src/components/library/SeriesGroupCard.tsx": 1,
}

const FIXED_SIZE = /\bfontSize:\s*\d/g

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
}

function fixedSizeCount(source) {
  return (stripComments(source).match(FIXED_SIZE) ?? []).length
}

describe("My Watch screens use the shared typography scale", () => {
  it("the pattern catches a fixed size and ignores a token and a comment", () => {
    expect(fixedSizeCount("durationText: { fontSize: 11 }")).toBe(1)
    expect(fixedSizeCount("gap: { fontSize: 15.5 }")).toBe(1)
    expect(fixedSizeCount("style={[styles.title, typography.caption]}")).toBe(0)
    expect(fixedSizeCount("// was fontSize: 11 before the token")).toBe(0)
  })

  it.each(FILES)("%s sets no fixed font size", (file) => {
    const source = fs.readFileSync(path.join(MOBILE_ROOT, file), "utf8")
    expect(fixedSizeCount(source)).toBe(ALLOWED_FIXED_SIZES[file] ?? 0)
  })
})
