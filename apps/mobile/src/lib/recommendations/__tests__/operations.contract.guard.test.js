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
// U8: the two push write documents ride the same fleet bearer and the same
// Admin SDL, so they belong in the same real-contract guard.
const {
  PUSH_DOCUMENTS,
  PUSH_OPERATION_NAMES,
} = require("../../push/operations")

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

describe("push operations against the committed Admin SDL", () => {
  it.each(Object.entries(PUSH_DOCUMENTS))(
    "%s validates against apps/admin/schema.graphql",
    (_name, doc) => {
      const errors = validate(schema, doc)
      expect(errors.map((error) => error.message)).toEqual([])
    },
  )

  it.each(Object.entries(PUSH_DOCUMENTS))(
    "%s is keyed by its own operation name",
    (name, doc) => {
      // The name IS the contract: the fleet-bearer allowlist keys on it, so a
      // rename silences the header on that operation with no error anywhere.
      expect(operationOf(doc)?.name?.value).toBe(name)
      expect(PUSH_OPERATION_NAMES).toContain(name)
    },
  )

  it("covers both push documents, so neither can be dropped silently", () => {
    expect(Object.keys(PUSH_DOCUMENTS).sort()).toEqual([
      "RegisterPushDevice",
      "ReportPushOpen",
    ])
  })

  it("asks the open report for its outcome, which the app branches on", () => {
    // All three outcomes are normal receipts (KTD14). Dropping the selection
    // leaves the client unable to tell STORED from UNKNOWN.
    expect(print(PUSH_DOCUMENTS.ReportPushOpen)).toContain("outcome")
  })
})
