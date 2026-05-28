import { describe, expect, it } from "vitest"

import {
  HTML_SUFFIX,
  HTML_SUFFIX_REGEX,
  appendHtmlSuffix,
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
