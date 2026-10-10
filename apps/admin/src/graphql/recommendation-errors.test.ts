import { GraphQLObjectType, GraphQLSchema, GraphQLString } from "graphql"
import { createYoga } from "graphql-yoga"
import { describe, expect, it, vi } from "vitest"
import {
  RecommendationInputError,
  RecommendationInternalStateError,
} from "@/services/recommendations/errors"
import { resolveRecommendationOperation } from "./recommendation-errors"

// Yoga loads GraphQL through Node. Share that instance instead of Vitest's
// transformed ESM instance, whose schema/error classes belong to another realm.
vi.mock("graphql", async () => {
  const { createRequire } = await import("node:module")
  return createRequire(import.meta.url)("graphql") as typeof import("graphql")
})

describe("recommendation errors through the Yoga response boundary", () => {
  it.each([
    new RecommendationInternalStateError(
      "recommendation_serialization_exhausted",
    ),
    Object.assign(new Error("private SQL must not escape"), {
      code: "P2010",
      meta: { code: "40001" },
    }),
  ])(
    "keeps transient storage failures internal and masks details",
    async (error) => {
      const result = await responseFor(error)
      expect(result.errors).toEqual([
        expect.objectContaining({
          message: "Unexpected error.",
          extensions: { code: "INTERNAL_SERVER_ERROR" },
        }),
      ])
      expect(JSON.stringify(result)).not.toMatch(
        /SQL|P2010|40001|serialization_exhausted/,
      )
    },
  )

  it("keeps genuine invalid input terminal", async () => {
    const result = await responseFor(
      new RecommendationInputError("Invalid payload"),
    )
    expect(result.errors).toEqual([
      expect.objectContaining({ extensions: { code: "BAD_USER_INPUT" } }),
    ])
  })
})

async function responseFor(error: unknown) {
  const schema = new GraphQLSchema({
    query: new GraphQLObjectType({
      name: "Query",
      fields: {
        recommendation: {
          type: GraphQLString,
          resolve: () =>
            resolveRecommendationOperation(async () => {
              throw error
            }),
        },
      },
    }),
  })
  const yoga = createYoga({ schema, logging: false })
  const response = await yoga.fetch("http://localhost/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "{ recommendation }" }),
  })
  return response.json()
}
