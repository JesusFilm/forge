// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs/path to read the route file.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// The video details page hides the Bible quotes carousel's share button
// (2026-09-17). The route has no render suite, so this pins the call site: a
// one-line revert there compiles and leaves every other suite green.
const ROUTE = path.join(__dirname, "..", "[slug].tsx")

describe("video details page Bible quotes carousel", () => {
  it("renders the carousel with the share button turned off", () => {
    const source = fs.readFileSync(ROUTE, "utf8")
    const elements = source.match(/<BibleQuotesCarouselRenderer\b[\s\S]*?\/>/g)

    expect(elements).toHaveLength(1)
    expect(elements[0]).toMatch(/\bshowShareButton=\{false\}/)
  })
})
