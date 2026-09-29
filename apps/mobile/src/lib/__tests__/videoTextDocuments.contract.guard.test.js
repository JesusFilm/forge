/**
 * Real-contract guard for U6: every document that reads Admin content in the
 * UI locale validates against the COMMITTED Admin SDL. The shape guards in
 * queries.test.ts prove the spelling; this proves that Admin will parse it
 * (the argument names, the literal `"english"`, and the `@skip` aliases).
 *
 * Plain JS, as in operations.contract.guard.test.js: this guard reads the SDL
 * with fs/path, and the RN tsconfig has no Node types.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const { readFileSync } = require("node:fs")
const path = require("node:path")
const { buildSchema, print, validate } = require("graphql")

const queries = require("../queries")
const {
  videoThumbnailsDocument,
  videoThumbnailsVariables,
} = require("../../hooks/useVideoThumbnails")

const ADMIN_SDL_PATH = path.resolve(
  __dirname,
  "../../../../admin/schema.graphql",
)

const schema = buildSchema(readFileSync(ADMIN_SDL_PATH, "utf8"))

const U6_DOCUMENTS = [
  "GET_VIDEO_BY_SLUG",
  "GET_VIDEO_TEXT",
  "GET_SERIES_BY_SLUG",
  "GET_SERIES_TEXT",
  "GET_WATCH_HOME_VIDEOS",
  "GET_WATCH_SETTING",
  "GET_EXPERIENCE_BY_SLUG",
]

describe("U6 documents against the committed Admin SDL", () => {
  it.each(U6_DOCUMENTS)("%s validates", (name) => {
    const doc = queries[name]
    expect(doc).toBeDefined()
    const errors = validate(schema, doc)
    expect(errors.map((error) => error.message)).toEqual([])
  })

  it("the Experience card batch validates for one and for several ids", () => {
    for (const count of [1, 3]) {
      const errors = validate(schema, videoThumbnailsDocument(count))
      expect(errors.map((error) => error.message)).toEqual([])
    }
  })

  // The old hand-built string wrote each id into the document text.
  it("the Experience card batch carries its ids as variables only", () => {
    const ids = ["cmpbs74n6036v6d819ppuc9fo", "abc-123_def"]
    const printed = print(videoThumbnailsDocument(ids.length))
    for (const id of ids) expect(printed).not.toContain(id)
    expect(videoThumbnailsVariables(ids, "russian")).toEqual({
      textSlug: "russian",
      id0: ids[0],
      id1: ids[1],
    })
  })

  // Positive control: a document with an unknown argument fails the same check.
  it("rejects a locales(...) argument Admin does not know (positive control)", () => {
    const { parse } = require("graphql")
    const bad = parse(
      'query Bad($slug: String!) { videoBySlug(slug: $slug) { locales(language: "x") { title } } }',
    )
    expect(validate(schema, bad).length).toBeGreaterThan(0)
  })
})
