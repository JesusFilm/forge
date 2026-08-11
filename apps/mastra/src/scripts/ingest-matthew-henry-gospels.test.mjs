import { describe, expect, it } from "vitest"

import { parseReflectionDocument } from "../services/devotional/reflection-corpus"
import {
  buildMatthewHenryGospelsCorpus,
  decode,
} from "./ingest-matthew-henry-gospels.mjs"

describe("decode", () => {
  it("decodes supported named and numeric entities in one pass", () => {
    expect(decode("&amp;&lt;&gt;&quot;&apos;&#65;")).toBe("&<>\"'A")
  })

  it("does not recursively decode nested entities", () => {
    expect(decode("&amp;lt; &amp;#60;")).toBe("&lt; &#60;")
  })
})

describe("Matthew Henry corpus generation", () => {
  it("builds a document accepted by the runtime reflection parser", () => {
    const document = buildMatthewHenryGospelsCorpus(`
      <div1 title="Mark">
        <div2 title="Chapter I"><p>Faith &amp; grace.</p></div2>
      </div1>
      <div1 title="Luke"></div1>
      <div1 title="John"></div1>
    `)

    expect(
      parseReflectionDocument({
        path: "/inputs/reflections/matthew-henry-gospels.json",
        content: JSON.stringify(document),
      }),
    ).toEqual([
      expect.objectContaining({
        reference: "Mark 1",
        osisRef: "Mark.1",
        text: "Faith & grace.",
      }),
    ])
  })
})
