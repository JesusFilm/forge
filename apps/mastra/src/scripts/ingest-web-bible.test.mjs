import { describe, expect, it } from "vitest"

import { parseWebBibleDocument } from "../services/devotional/web-bible"
import { buildWebBibleCorpus } from "./ingest-web-bible.mjs"

describe("WEB corpus generation", () => {
  it("builds a document accepted by the runtime scripture parser", () => {
    const document = buildWebBibleCorpus([
      {
        osis: "John",
        book: {
          chapters: [
            {
              verses: [
                {
                  chapter: 3,
                  verse: 16,
                  text: "  For God so loved   the world.  ",
                },
              ],
            },
          ],
        },
      },
    ])

    expect(
      parseWebBibleDocument({
        path: "/inputs/scripture/web-bible.json",
        content: JSON.stringify(document),
      }),
    ).toEqual({ verses: { "John.3.16": "For God so loved the world." } })
  })
})
