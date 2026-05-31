import { afterEach, describe, expect, it, vi } from "vitest"

describe("Mastra env", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("accepts local development without service keys", async () => {
    vi.stubEnv("NODE_ENV", "development")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).not.toThrow()
  })

  it("requires service keys in production runtime", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY", "admin-exp-key")
    vi.stubEnv("ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY", "admin-ingest-key")
    vi.stubEnv("ADMIN_MASTRA_SCENE_INGEST_API_KEY", "admin-scene-key")
    vi.stubEnv(
      "ADMIN_EXPERIENCE_INGEST_URL",
      "https://admin.internal/api/internal/mastra/experience-embeddings",
    )
    vi.stubEnv(
      "ADMIN_TRANSCRIPT_INGEST_URL",
      "https://admin.internal/api/internal/mastra/transcript-embeddings",
    )
    vi.stubEnv(
      "ADMIN_SCENE_INGEST_URL",
      "https://admin.internal/api/internal/mastra/scene-embeddings",
    )
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres:postgres@localhost:5432/forge_mastra_gateway",
    )
    vi.stubEnv("MASTRA_STORAGE_DIR", "/data/mastra")
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "")
    vi.stubEnv("MASTRA_ENRICHMENT_API_KEYS", "test-enrichment-key")
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).toThrow(
      "MASTRA_SERVICE_API_KEYS required for Mastra production",
    )
  })

  it("requires a database URL in production runtime", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY", "admin-exp-key")
    vi.stubEnv("ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY", "admin-ingest-key")
    vi.stubEnv("ADMIN_MASTRA_SCENE_INGEST_API_KEY", "admin-scene-key")
    vi.stubEnv(
      "ADMIN_EXPERIENCE_INGEST_URL",
      "https://admin.internal/api/internal/mastra/experience-embeddings",
    )
    vi.stubEnv(
      "ADMIN_TRANSCRIPT_INGEST_URL",
      "https://admin.internal/api/internal/mastra/transcript-embeddings",
    )
    vi.stubEnv(
      "ADMIN_SCENE_INGEST_URL",
      "https://admin.internal/api/internal/mastra/scene-embeddings",
    )
    vi.stubEnv("DATABASE_URL", "")
    vi.stubEnv("MASTRA_STORAGE_DIR", "/data/mastra")
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "test-service-key")
    vi.stubEnv("MASTRA_ENRICHMENT_API_KEYS", "test-enrichment-key")
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).toThrow(
      "DATABASE_URL required for Mastra production",
    )
  })

  it("accepts production runtime without an explicit storage dir", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY", "admin-exp-key")
    vi.stubEnv("ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY", "admin-ingest-key")
    vi.stubEnv("ADMIN_MASTRA_SCENE_INGEST_API_KEY", "admin-scene-key")
    vi.stubEnv(
      "ADMIN_EXPERIENCE_INGEST_URL",
      "https://admin.internal/api/internal/mastra/experience-embeddings",
    )
    vi.stubEnv(
      "ADMIN_TRANSCRIPT_INGEST_URL",
      "https://admin.internal/api/internal/mastra/transcript-embeddings",
    )
    vi.stubEnv(
      "ADMIN_SCENE_INGEST_URL",
      "https://admin.internal/api/internal/mastra/scene-embeddings",
    )
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres:postgres@localhost:5432/forge_mastra_gateway",
    )
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "test-service-key")
    vi.stubEnv("MASTRA_ENRICHMENT_API_KEYS", "test-enrichment-key")
    vi.stubEnv("MASTRA_STORAGE_DIR", "")
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).not.toThrow()
  })

  it("does not require enrichment receiver keys at production boot", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY", "admin-exp-key")
    vi.stubEnv("ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY", "admin-ingest-key")
    vi.stubEnv("ADMIN_MASTRA_SCENE_INGEST_API_KEY", "admin-scene-key")
    vi.stubEnv(
      "ADMIN_EXPERIENCE_INGEST_URL",
      "https://admin.internal/api/internal/mastra/experience-embeddings",
    )
    vi.stubEnv(
      "ADMIN_TRANSCRIPT_INGEST_URL",
      "https://admin.internal/api/internal/mastra/transcript-embeddings",
    )
    vi.stubEnv(
      "ADMIN_SCENE_INGEST_URL",
      "https://admin.internal/api/internal/mastra/scene-embeddings",
    )
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres:postgres@localhost:5432/forge_mastra_gateway",
    )
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "test-service-key")
    vi.stubEnv("MASTRA_ENRICHMENT_API_KEYS", "")
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).not.toThrow()
  })

  it("defaults storage to the local gateway database in development", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("DATABASE_URL", "")

    const { getMastraDatabaseUrl } = await import("./env")

    expect(getMastraDatabaseUrl()).toBe(
      "postgresql://postgres:postgres@localhost:5432/forge_mastra_gateway",
    )
  })

  it("defaults file storage to the local Mastra storage directory in development", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MASTRA_STORAGE_DIR", "")

    const { getMastraStorageDir } = await import("./env")

    expect(getMastraStorageDir()).toBe(".mastra/storage")
  })

  it("uses the Railway volume mount path for storage when present", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("MASTRA_STORAGE_DIR", "")
    vi.stubEnv("RAILWAY_VOLUME_MOUNT_PATH", "/data/")

    const { getMastraStorageDir } = await import("./env")

    expect(getMastraStorageDir()).toBe("/data/mastra")
  })

  it("defaults transcript, scene, and experience embedding model and provider settings", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("TRANSCRIPT_EMBEDDING_MODEL", "")
    vi.stubEnv("TRANSCRIPT_EMBEDDING_PROVIDER", "")
    vi.stubEnv("SCENE_EMBEDDING_MODEL", "")
    vi.stubEnv("SCENE_EMBEDDING_PROVIDER", "")
    vi.stubEnv("EXPERIENCE_EMBEDDING_MODEL", "")
    vi.stubEnv("EXPERIENCE_EMBEDDING_PROVIDER", "")
    vi.stubEnv("EVAL_QUERY_GENERATION_MODEL", "")
    vi.stubEnv("OPENAI_EMBEDDINGS_BASE_URL", "")
    vi.stubEnv("OPENROUTER_EMBEDDINGS_BASE_URL", "")

    const { env } = await import("./env")

    expect(env.TRANSCRIPT_EMBEDDING_MODEL).toBe("openai/text-embedding-3-small")
    expect(env.TRANSCRIPT_EMBEDDING_PROVIDER).toBe("openai")
    expect(env.SCENE_EMBEDDING_MODEL).toBe("openai/text-embedding-3-small")
    expect(env.SCENE_EMBEDDING_PROVIDER).toBe("openai")
    expect(env.EXPERIENCE_EMBEDDING_MODEL).toBe("openai/text-embedding-3-small")
    expect(env.EXPERIENCE_EMBEDDING_PROVIDER).toBe("openai")
    expect(env.EVAL_QUERY_GENERATION_MODEL).toBe("anthropic/claude-haiku-4-5")
    expect(env.OPENAI_EMBEDDINGS_BASE_URL).toBe("https://api.openai.com/v1")
    expect(env.OPENROUTER_EMBEDDINGS_BASE_URL).toBe(
      "https://openrouter.ai/api/v1",
    )
  })

  it("requires either OpenRouter or OpenAI credentials in production runtime", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY", "admin-exp-key")
    vi.stubEnv("ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY", "admin-ingest-key")
    vi.stubEnv("ADMIN_MASTRA_SCENE_INGEST_API_KEY", "admin-scene-key")
    vi.stubEnv(
      "ADMIN_EXPERIENCE_INGEST_URL",
      "https://admin.internal/api/internal/mastra/experience-embeddings",
    )
    vi.stubEnv(
      "ADMIN_TRANSCRIPT_INGEST_URL",
      "https://admin.internal/api/internal/mastra/transcript-embeddings",
    )
    vi.stubEnv(
      "ADMIN_SCENE_INGEST_URL",
      "https://admin.internal/api/internal/mastra/scene-embeddings",
    )
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres:postgres@localhost:5432/forge_mastra_gateway",
    )
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "test-service-key")
    vi.stubEnv("MASTRA_ENRICHMENT_API_KEYS", "test-enrichment-key")
    vi.stubEnv("OPENAI_API_KEY", "")
    vi.stubEnv("OPENROUTER_API_KEY", "")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).toThrow(
      "OPENROUTER_API_KEY or OPENAI_API_KEY required for Mastra production",
    )
  })

  it("prefers OpenRouter credentials for embedding provider config", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("OPENAI_API_KEY", "openai-key")
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")

    const {
      getExperienceEmbeddingProviderConfig,
      getSceneEmbeddingProviderConfig,
      getTranscriptEmbeddingProviderConfig,
    } = await import("./env")

    expect(getTranscriptEmbeddingProviderConfig()).toEqual({
      apiKey: "openrouter-key",
      baseUrl: "https://openrouter.ai/api/v1",
    })
    expect(getSceneEmbeddingProviderConfig()).toEqual({
      apiKey: "openrouter-key",
      baseUrl: "https://openrouter.ai/api/v1",
    })
    expect(getExperienceEmbeddingProviderConfig()).toEqual({
      apiKey: "openrouter-key",
      baseUrl: "https://openrouter.ai/api/v1",
    })
  })
})
