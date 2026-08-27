import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { zodToJsonSchema } from "zod-to-json-schema"
import {
  citationSchema,
  rankedResultSchema,
  retrievalPolicySchema,
  searchRequestSchema,
  searchResponseSchema,
} from "../src/index.js"

export const ARTIFACT_URL = new URL("../openapi.v1.json", import.meta.url)
type JsonObject = Record<string, unknown>
const jsonSchema = (
  schema: Parameters<typeof zodToJsonSchema>[0],
): JsonObject =>
  zodToJsonSchema(schema, {
    target: "openApi3",
    $refStrategy: "none",
  }) as JsonObject
const ref = (name: string): JsonObject => ({
  $ref: `#/components/schemas/${name}`,
})
const propertiesOf = (schema: JsonObject): JsonObject =>
  schema.properties as JsonObject
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: ref("Error") } },
})

export function buildOpenApiDocument(): JsonObject {
  const citation = jsonSchema(citationSchema)
  const retrievalPolicy = jsonSchema(retrievalPolicySchema)
  const rankedResult = jsonSchema(rankedResultSchema)
  propertiesOf(rankedResult).citation = ref("Citation")
  const searchRequest = jsonSchema(searchRequestSchema)
  propertiesOf(searchRequest).policy = ref("RetrievalPolicy")
  const searchResponse = jsonSchema(searchResponseSchema)
  const resultsSchema = propertiesOf(searchResponse).results as JsonObject
  resultsSchema.items = ref("RankedResult")

  return {
    openapi: "3.0.3",
    info: {
      title: "JesusFilm RAG — Retrieval API",
      version: "1.0.0",
      description:
        "Read-only retrieval over a curated, cited corpus. The canonical shape consumers map onto; the engine does not bend. Versioning: additive change = same major; breaking change = a new /v2 beside /v1.",
    },
    paths: {
      "/v1/health": {
        get: {
          summary: "Liveness probe (unauthenticated).",
          responses: {
            "200": {
              description: "Service is up.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { status: { type: "string", enum: ["ok"] } },
                    required: ["status"],
                  },
                },
              },
            },
          },
        },
      },
      "/v1/search": {
        post: {
          summary: "Retrieve ranked, cited results for a query.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: ref("SearchRequest") } },
          },
          responses: {
            "200": {
              description: "Ranked results (possibly empty).",
              content: {
                "application/json": { schema: ref("SearchResponse") },
              },
            },
            "400": errorResponse(
              "Malformed JSON or request failing the contract.",
            ),
            "401": errorResponse("Missing or unknown bearer token."),
            "500": errorResponse(
              "Internal error — e.g. a retrieval or embedding-provider failure.",
            ),
          },
        },
      },
    },
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      schemas: {
        RetrievalPolicy: retrievalPolicy,
        RankedResult: rankedResult,
        Citation: citation,
        SearchRequest: searchRequest,
        SearchResponse: searchResponse,
        Error: {
          type: "object",
          properties: { error: { type: "string" }, issues: { type: "array" } },
          required: ["error"],
        },
      },
    },
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  writeFileSync(
    ARTIFACT_URL,
    `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`,
  )
