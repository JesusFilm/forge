/**
 * In-memory fakes for every contract port (docs/architecture.md §5.6). Each
 * context's unit tests run against these — no Postgres, no network. A context
 * that can't be tested on fakes is already coupled.
 */
export { FakeEmbedder, type FakeEmbedderOptions } from "./embedder.js"
export {
  FakeLanguageDetector,
  FakeLlmReviewer,
  type FakeLanguageDetectorOptions,
} from "./language-detector.js"
export { FakeFetcher } from "./fetcher.js"
export { FakeFetchStateStore } from "./fetch-state-store.js"
export { FakeRawDocumentStore } from "./raw-document-store.js"
export { FakeRawDocumentReader } from "./raw-document-reader.js"
export {
  FakeCorpusWriteStore,
  type StoredDocument,
} from "./corpus-write-store.js"
export {
  FakeCorpusSearchStore,
  type FakeIndexedChunk,
} from "./corpus-search-store.js"
export { cosineSimilarity, deterministicVector } from "./vector-math.js"
