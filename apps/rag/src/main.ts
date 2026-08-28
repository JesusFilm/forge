import { PrismaClient } from "./generated/prisma/index.js"

import {
  PostgresCorpusSearchStore,
  PostgresCorpusWriteStore,
  PostgresFetchStateStore,
  PostgresRawDocumentReader,
  PostgresRawDocumentStore,
  EMBEDDING_DIMENSIONS,
} from "./adapters/postgres/index.js"
import {
  FallbackEmbedder,
  OpenAICompatibleEmbedder,
} from "./adapters/embeddings/index.js"
import { parseRuntimeEnv } from "./config/env.js"
import type {
  CorpusSearchStore,
  CorpusWriteStore,
  Embedder,
  FetchStateStore,
  RawDocumentReader,
  RawDocumentStore,
  Retriever,
} from "./contracts/index.js"
import { createRetriever } from "./retrieval/index.js"

export type Wiring = {
  corpusWriteStore: CorpusWriteStore
  corpusSearchStore: CorpusSearchStore
  fetchStateStore: FetchStateStore
  rawDocumentStore: RawDocumentStore
  rawDocumentReader: RawDocumentReader
  queryEmbedder: Embedder
  retriever: Retriever
  shutdown(): Promise<void>
}

export function wire(input = process.env): Wiring {
  const env = parseRuntimeEnv(input)
  const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL })
  const corpusSearchStore = new PostgresCorpusSearchStore(prisma)
  const sharedEmbedderOptions = {
    model: env.EMBED_MODEL_ID,
    dimensions: EMBEDDING_DIMENSIONS,
    truncateToDimensions: env.EMBED_TRUNCATE_DIMENSIONS,
    queryInstruction: env.EMBED_QUERY_INSTRUCTION,
    timeoutMs: env.QUERY_EMBED_TIMEOUT_MS,
    maxAttempts: env.QUERY_EMBED_MAX_ATTEMPTS,
  }
  const hostedOpenRouterEmbedder = new OpenAICompatibleEmbedder({
    ...sharedEmbedderOptions,
    apiKey: env.OPENROUTER_API_KEY,
    baseUrl: "https://openrouter.ai/api/v1",
  })
  const queryEmbedder = env.EMBED_BASE_URL
    ? new FallbackEmbedder({
        primary: new OpenAICompatibleEmbedder({
          ...sharedEmbedderOptions,
          apiKey: env.EMBED_API_KEY as string,
          baseUrl: env.EMBED_BASE_URL,
          wireModel: env.EMBED_WIRE_MODEL_ID,
        }),
        fallback: hostedOpenRouterEmbedder,
        onFallback: (error) => {
          const reason =
            error instanceof Error ? error.message : "unknown error"
          console.warn(
            `query embed: gateway failed (${reason}); falling back to hosted OpenRouter`,
          )
        },
      })
    : hostedOpenRouterEmbedder
  return {
    corpusWriteStore: new PostgresCorpusWriteStore(prisma),
    corpusSearchStore,
    fetchStateStore: new PostgresFetchStateStore(prisma),
    rawDocumentStore: new PostgresRawDocumentStore(prisma),
    rawDocumentReader: new PostgresRawDocumentReader(prisma),
    queryEmbedder,
    retriever: createRetriever({
      embedder: queryEmbedder,
      search: corpusSearchStore,
    }),
    shutdown: () => prisma.$disconnect(),
  }
}
