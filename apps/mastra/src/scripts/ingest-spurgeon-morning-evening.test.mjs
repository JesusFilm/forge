import { describe, expect, it } from "vitest"

import { parseReflectionDocument } from "../services/devotional/reflection-corpus"
import {
  buildSpurgeonMorningEveningCorpus,
  decode,
} from "./ingest-spurgeon-morning-evening.mjs"

describe("decode", () => {
  it("decodes supported named and numeric entities in one pass", () => {
    expect(decode("&amp;&lt;&gt;&quot;&apos;&#65;")).toBe("&<>\"'A")
  })

  it("does not recursively decode nested entities", () => {
    expect(decode("&amp;lt; &amp;#60;")).toBe("&lt; &#60;")
  })
})

describe("Spurgeon corpus generation", () => {
  it("builds a document accepted by the runtime reflection parser", () => {
    const document = buildSpurgeonMorningEveningCorpus(`
      <div2 id="d0101am">
        <scripRef osisRef="Bible:Gen.1.1">Genesis 1:1</scripRef>
        <p class="passage">In the beginning</p>
        <p class="normal">The Lord is faithful.</p>
      </div2>
    `)

    expect(
      parseReflectionDocument({
        path: "/inputs/reflections/spurgeon-morning-evening.json",
        content: JSON.stringify(document),
      }),
    ).toEqual([
      expect.objectContaining({
        reference: "Genesis 1:1",
        osisRef: "Gen.1.1",
        verse: "In the beginning",
        text: "The Lord is faithful.",
      }),
    ])
  })
})
