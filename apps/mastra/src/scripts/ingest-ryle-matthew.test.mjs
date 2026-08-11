import { describe, expect, it } from "vitest"

import { parseReflectionDocument } from "../services/devotional/reflection-corpus"
import { buildRyleMatthewCorpus, decode } from "./ingest-ryle-matthew.mjs"

describe("Ryle corpus entity decoding", () => {
  it("decodes supported entities exactly once", () => {
    expect(
      decode("&amp; &lt; &gt; &quot; &apos; &#60; &amp;lt; &amp;#60;"),
    ).toBe("& < > \" ' < &lt; &#60;")
  })
})

describe("Ryle corpus generation", () => {
  it("builds a document accepted by the runtime reflection parser", () => {
    const document = buildRyleMatthewCorpus(`
      <div2 title="Matthew 3:1-2">
        <scripRef osisRef="Bible:Matt.3.1-Matt.3.2">Matthew 3:1-2</scripRef>
        <p>Repent &amp; prepare.</p>
      </div2>
    `)

    expect(
      parseReflectionDocument({
        path: "/inputs/reflections/ryle-matthew.json",
        content: JSON.stringify(document),
      }),
    ).toEqual([
      expect.objectContaining({
        reference: "Matthew 3:1-2",
        osisRef: "Matt.3.1-Matt.3.2",
        text: "Repent & prepare.",
      }),
    ])
  })
})
