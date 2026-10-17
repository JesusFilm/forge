// SOURCE-SHAPE guard (R7): the watch, series, and Experience error screens show
// catalog text only. Apollo's `error.message` is English, and the no-English
// guard cannot see text that a variable carries.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

const SCREENS = [
  { file: "watch/[slug].tsx", key: 't("loadError")' },
  { file: "series/[slug].tsx", key: 't("loadError")' },
  { file: "experience/[slug].tsx", key: 't("loadErrorMessage")' },
]

// A Text whose children read the error value, e.g. {error?.message ?? ...}.
const RAW_ERROR_TEXT = /<Text\b[^>]*>\s*\{\s*error(\?\.|\.|\s*\})/

function errorMessageText(source) {
  const start = source.indexOf("style={text.errorMessage}")
  if (start === -1) return null
  const end = source.indexOf("</Text>", start)
  return source.slice(source.lastIndexOf("<Text", start), end + 7)
}

describe("error screens show catalog text, never the raw error", () => {
  it.each(SCREENS)("$file", ({ file, key }) => {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8")
    const block = errorMessageText(source)
    expect(block).not.toBeNull()
    expect(block).toContain(key)
    expect(RAW_ERROR_TEXT.test(block)).toBe(false)
  })

  it("flags a Text that renders the raw error (negative control)", () => {
    const bad = [
      "<Text style={text.errorMessage}>",
      '  {error?.message ?? t("loadError")}',
      "</Text>",
    ].join("\n")
    expect(RAW_ERROR_TEXT.test(errorMessageText(bad))).toBe(true)
    expect(
      RAW_ERROR_TEXT.test(
        errorMessageText("<Text style={text.errorMessage}>{error}</Text>"),
      ),
    ).toBe(true)
  })
})
