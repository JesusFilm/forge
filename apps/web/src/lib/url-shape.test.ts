import { describe, expect, it } from "vitest"

import {
  HTML_SUFFIX,
  HTML_SUFFIX_REGEX,
  appendHtmlSuffix,
  getWatchLocaleSegmentIndex,
  hasHtmlSuffix,
  stripHtmlSuffix,
} from "./url-shape"

describe("HTML_SUFFIX constants", () => {
  it("exposes the literal .html suffix", () => {
    expect(HTML_SUFFIX).toBe(".html")
  })

  it("uses case-insensitive anchored regex", () => {
    expect(HTML_SUFFIX_REGEX.test("foo.html")).toBe(true)
    expect(HTML_SUFFIX_REGEX.test("foo.HTML")).toBe(true)
    expect(HTML_SUFFIX_REGEX.test("foo.htmlx")).toBe(false)
    expect(HTML_SUFFIX_REGEX.test("foo")).toBe(false)
  })
})

describe("stripHtmlSuffix", () => {
  it("removes .html from end", () => {
    expect(stripHtmlSuffix("jesus.html")).toBe("jesus")
  })

  it("removes .HTML case-insensitively", () => {
    expect(stripHtmlSuffix("jesus.HTML")).toBe("jesus")
  })

  it("leaves bare slug unchanged", () => {
    expect(stripHtmlSuffix("jesus")).toBe("jesus")
  })

  it("does not strip embedded .html", () => {
    expect(stripHtmlSuffix("foo.html.bar")).toBe("foo.html.bar")
  })

  it("handles empty string", () => {
    expect(stripHtmlSuffix("")).toBe("")
  })

  it("handles a multi-hyphen slug with .html", () => {
    expect(stripHtmlSuffix("portuguese-brazil.html")).toBe("portuguese-brazil")
  })
})

describe("hasHtmlSuffix", () => {
  it("matches lowercase suffix", () => {
    expect(hasHtmlSuffix("jesus.html")).toBe(true)
  })

  it("matches uppercase suffix", () => {
    expect(hasHtmlSuffix("jesus.HTML")).toBe(true)
  })

  it("rejects bare slug", () => {
    expect(hasHtmlSuffix("jesus")).toBe(false)
  })

  it("rejects suffix-prefix overlap", () => {
    expect(hasHtmlSuffix("foo.htmlx")).toBe(false)
  })
})

describe("appendHtmlSuffix", () => {
  it("appends .html to bare slug", () => {
    expect(appendHtmlSuffix("jesus")).toBe("jesus.html")
  })

  it("does not double-append when already suffixed", () => {
    expect(appendHtmlSuffix("jesus.html")).toBe("jesus.html")
  })

  it("treats uppercase suffix as already-suffixed (idempotent)", () => {
    expect(appendHtmlSuffix("jesus.HTML")).toBe("jesus.HTML")
  })

  it("is idempotent: appendHtmlSuffix(appendHtmlSuffix(x)) === appendHtmlSuffix(x)", () => {
    const inputs = ["jesus", "jesus.html", "portuguese-brazil", ""]
    for (const x of inputs) {
      expect(appendHtmlSuffix(appendHtmlSuffix(x))).toBe(appendHtmlSuffix(x))
    }
  })
})

describe("getWatchLocaleSegmentIndex", () => {
  it("returns 1 for 2-segment shape /{slug}/{locale}", () => {
    expect(getWatchLocaleSegmentIndex(["jesus", "english.html"])).toBe(1)
  })

  it("returns 2 for 3-segment shape /{series}/{episode}/{locale}", () => {
    expect(
      getWatchLocaleSegmentIndex([
        "lumo-the-gospel-of-john.html",
        "wedding-in-cana",
        "english.html",
      ]),
    ).toBe(2)
  })

  it("returns -1 for empty segments", () => {
    expect(getWatchLocaleSegmentIndex([])).toBe(-1)
  })

  it("returns -1 for 1-segment shape", () => {
    expect(getWatchLocaleSegmentIndex(["jesus.html"])).toBe(-1)
  })

  it("returns -1 for 4+ segments", () => {
    expect(getWatchLocaleSegmentIndex(["a", "b", "c", "d"])).toBe(-1)
  })

  it("accepts both .html-suffixed and bare segments (shape-only check)", () => {
    expect(getWatchLocaleSegmentIndex(["jesus", "english"])).toBe(1)
    expect(getWatchLocaleSegmentIndex(["jesus.html", "english.html"])).toBe(1)
  })
})
