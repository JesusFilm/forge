import { describe, expect, it } from "vitest"

import { decode } from "./ingest-ryle-matthew.mjs"

describe("Ryle corpus entity decoding", () => {
  it("decodes supported entities exactly once", () => {
    expect(
      decode("&amp; &lt; &gt; &quot; &apos; &#60; &amp;lt; &amp;#60;"),
    ).toBe("& < > \" ' < &lt; &#60;")
  })
})
