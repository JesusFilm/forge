// Pothos types for VideoTranscript and VideoTranscriptChunk.
//
// Transcript data is language-tagged chunked text from apps/manager's
// embeddings pipeline — public-shape (Core-sourced, not editor-owned).
// The `embedding` vector column on VideoTranscriptChunk is INTENTIONALLY
// OMITTED from the Pothos field list so it never leaves the backend;
// `schema.test.ts` asserts the "no embed|vector|similarit" contract
// across the full SDL.
//
// These types are minimal scaffolding for R4 (hybrid search) and R5
// (recommendations). Relations (`transcript.chunks`, etc.) are NOT
// declared here because no downstream consumer needs them yet; adding
// them preemptively would clutter the public SDL.

import { builder } from "@/graphql/builder"

/** @classification public-shape */
builder.prismaObject("VideoTranscript", {
  description:
    "Per-(edition, language) transcript index. Artifact-level metadata (model, dimensions, chunking strategy) for the chunks that hang off this row.",
  fields: (t) => ({
    id: t.exposeID("id"),
    videoEditionId: t.exposeID("videoEditionId"),
    videoId: t.exposeID("videoId"),
    language: t.exposeString("language"),
    model: t.exposeString("model"),
    dimensions: t.exposeInt("dimensions"),
    totalChunks: t.exposeInt("totalChunks"),
    totalTokens: t.exposeInt("totalTokens"),
    generatedAt: t.string({
      resolve: (row) => row.generatedAt.toISOString(),
    }),
    createdAt: t.string({ resolve: (row) => row.createdAt.toISOString() }),
    updatedAt: t.string({ resolve: (row) => row.updatedAt.toISOString() }),
  }),
})

/** @classification public-shape */
builder.prismaObject("VideoTranscriptChunk", {
  description:
    "A single chunk of a transcript. The underlying embedding vector is never exposed via GraphQL — read paths go through service-layer SQL in R4/R5.",
  fields: (t) => ({
    id: t.exposeID("id"),
    transcriptId: t.exposeID("transcriptId"),
    language: t.exposeString("language"),
    chunkIndex: t.exposeInt("chunkIndex"),
    chunkId: t.exposeString("chunkId"),
    text: t.exposeString("text"),
    tokenCount: t.exposeInt("tokenCount"),
    startSeconds: t.exposeFloat("startSeconds", { nullable: true }),
    endSeconds: t.exposeFloat("endSeconds", { nullable: true }),
    // NOTE: `embedding` deliberately omitted. Enforced by
    // src/graphql/schema.test.ts "no embed|vector|similarit" assertion.
    // `model` and `dimensions` are operational metadata already exposed
    // on the parent VideoTranscript row and not repeated here.
    createdAt: t.string({ resolve: (row) => row.createdAt.toISOString() }),
    updatedAt: t.string({ resolve: (row) => row.updatedAt.toISOString() }),
  }),
})
