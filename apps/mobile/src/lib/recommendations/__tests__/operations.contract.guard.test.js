/**
 * Real-contract guard: every recommendation document mobile sends validates
 * against the COMMITTED Admin SDL. A mocked transport proves branch shape only;
 * this proves the wire shape Admin will parse.
 *
 * Plain JS (like datadogReservedAttributes.guard.test.js): the RN tsconfig has
 * no Node types, and this guard needs fs/path to read the SDL.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const { readFileSync } = require("node:fs")
const path = require("node:path")
const { buildSchema, print, validate } = require("graphql")

const {
  RECOMMENDATION_DOCUMENTS,
  RECOMMENDATION_OPERATION_NAMES,
} = require("../operations")

const ADMIN_SDL_PATH = path.resolve(
  __dirname,
  "../../../../../admin/schema.graphql",
)

const schema = buildSchema(readFileSync(ADMIN_SDL_PATH, "utf8"))

function operationOf(doc) {
  return doc.definitions.find((d) => d.kind === "OperationDefinition")
}

describe("recommendation operations against the committed Admin SDL", () => {
  it.each(Object.entries(RECOMMENDATION_DOCUMENTS))(
    "%s validates against apps/admin/schema.graphql",
    (_name, doc) => {
      const errors = validate(schema, doc)
      expect(errors.map((error) => error.message)).toEqual([])
    },
  )

  it.each(Object.entries(RECOMMENDATION_DOCUMENTS))(
    "%s is keyed by its own operation name",
    (name, doc) => {
      expect(operationOf(doc)?.name?.value).toBe(name)
      expect(RECOMMENDATION_OPERATION_NAMES).toContain(name)
    },
  )

  // Viewer tokens and the Web session digest are mutually exclusive on the
  // wire; the shared documents declare both, so the exclusion must hold at the
  // variables mobile builds, and these pins keep the documents' shape visible.
  it("declares viewerToken and sessionToken on every identity-bearing operation", () => {
    const identityBearing = Object.entries(RECOMMENDATION_DOCUMENTS).filter(
      ([name]) => name !== "CreateRecommendationViewer",
    )
    for (const [, doc] of identityBearing) {
      const printed = print(doc)
      expect(printed).toContain("$viewerToken")
      expect(printed).toContain("$sessionToken")
    }
  })

  it("bootstraps with no variables at all", () => {
    const bootstrap = operationOf(
      RECOMMENDATION_DOCUMENTS.CreateRecommendationViewer,
    )
    expect(bootstrap?.variableDefinitions ?? []).toHaveLength(0)
  })
})
