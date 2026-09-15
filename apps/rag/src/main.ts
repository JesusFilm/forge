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
import { FirecrawlFetcher } from "./adapters/firecrawl/index.js"
import { HttpFetcher } from "./adapters/http/index.js"
import {
  OpenAICompatibleLanguageDetector,
  OpenAICompatibleLlmReviewer,
} from "./adapters/language/index.js"
import { parseRuntimeEnv } from "./config/env.js"
import type {
  CorpusSearchStore,
  CorpusWriteStore,
  Embedder,
  Fetcher,
  FetchStateStore,
  LanguageDetector,
  LlmReviewer,
  RawDocumentReader,
  RawDocumentStore,
  Retriever,
} from "./contracts/index.js"
import { resolveFetchStrategy, type SourceEntry } from "./registry/index.js"
import { createRetriever } from "./retrieval/index.js"

export type Wiring = {
  corpusWriteStore: CorpusWriteStore
  corpusSearchStore: CorpusSearchStore
  fetchStateStore: FetchStateStore
  rawDocumentStore: RawDocumentStore
  rawDocumentReader: RawDocumentReader
  fetcherFor(source: SourceEntry): Fetcher
  embedder: Embedder
  queryEmbedder: Embedder
  languageDetector: LanguageDetector
  llmReviewer: LlmReviewer
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
  }
  const makeEmbedder = (
    operation: "corpus" | "query",
    policy: { timeoutMs: number; maxAttempts: number },
  ) => {
    const hosted = new OpenAICompatibleEmbedder({
      ...sharedEmbedderOptions,
      ...policy,
      apiKey: env.OPENROUTER_API_KEY,
      baseUrl: "https://openrouter.ai/api/v1",
    })
    return env.EMBED_BASE_URL
      ? new FallbackEmbedder({
          primary: new OpenAICompatibleEmbedder({
            ...sharedEmbedderOptions,
            ...policy,
            apiKey: env.EMBED_API_KEY as string,
            baseUrl: env.EMBED_BASE_URL,
            wireModel: env.EMBED_WIRE_MODEL_ID,
          }),
          fallback: hosted,
          onFallback: (error) => {
            const reason =
              error instanceof Error ? error.message : "unknown error"
            console.warn(
              `${operation} embed: gateway failed (${reason}); falling back to hosted OpenRouter`,
            )
          },
        })
      : hosted
  }
  const embedder = makeEmbedder("corpus", {
    timeoutMs: env.EMBED_TIMEOUT_MS,
    maxAttempts: env.EMBED_MAX_ATTEMPTS,
  })
  const queryEmbedder = makeEmbedder("query", {
    timeoutMs: env.QUERY_EMBED_TIMEOUT_MS,
    maxAttempts: env.QUERY_EMBED_MAX_ATTEMPTS,
  })
  const httpFetcher = new HttpFetcher()
  let firecrawlFetcher: Fetcher | undefined
  const fetcherFor = (source: SourceEntry): Fetcher => {
    if (resolveFetchStrategy(source) === "plain-http") return httpFetcher
    if (!env.FIRECRAWL_API_KEY)
      throw new Error(
        `FIRECRAWL_API_KEY is required for Firecrawl-backed source '${source.key}'`,
      )
    return (firecrawlFetcher ??= new FirecrawlFetcher({
      apiKey: env.FIRECRAWL_API_KEY,
    }))
  }
  const languageOptions = {
    apiKey: env.OPENROUTER_API_KEY,
    model: env.LANG_DETECT_MODEL_ID,
    baseUrl: env.LANG_DETECT_BASE_URL,
    maxAttempts: env.LANG_DETECT_MAX_ATTEMPTS,
  }
  return {
    corpusWriteStore: new PostgresCorpusWriteStore(prisma),
    corpusSearchStore,
    fetchStateStore: new PostgresFetchStateStore(prisma),
    rawDocumentStore: new PostgresRawDocumentStore(prisma),
    rawDocumentReader: new PostgresRawDocumentReader(prisma),
    fetcherFor,
    embedder,
    queryEmbedder,
    languageDetector: new OpenAICompatibleLanguageDetector(languageOptions),
    llmReviewer: new OpenAICompatibleLlmReviewer(languageOptions),
    retriever: createRetriever({
      embedder: queryEmbedder,
      search: corpusSearchStore,
    }),
    shutdown: () => prisma.$disconnect(),
  }
}
