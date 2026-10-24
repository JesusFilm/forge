import { describe, expect, it } from "vitest"

import { decode } from "./ingest-matthew-henry-gospels.mjs"

describe("decode", () => {
  it("decodes supported named and numeric entities in one pass", () => {
    expect(decode("&amp;&lt;&gt;&quot;&apos;&#65;")).toBe("&<>\"'A")
  })

  it("does not recursively decode nested entities", () => {
    expect(decode("&amp;lt; &amp;#60;")).toBe("&lt; &#60;")
  })
})
