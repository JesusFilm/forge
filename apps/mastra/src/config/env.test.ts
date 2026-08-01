import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("Mastra env", () => {
  beforeEach(() => {
    vi.stubEnv("FIRECRAWL_API_KEY", "firecrawl-key")
  })

  afterEach(() => {
    vi.doUnmock("../services/embedding-provider")
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("accepts local development without service keys", async () => {
    vi.stubEnv("NODE_ENV", "development")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).not.toThrow()
  })

  it("refuses boot when a key value appears in BOTH the pool and ai-chat lane CSVs (feat-241, KTD2)", async () => {
    // Wiring pin: assertMastraRuntimeEnv() itself must invoke the
    // disjointness assertion with the real env-sourced defaults.
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "pool-a,shared-overlap-key")
    vi.stubEnv("AI_CHAT_SERVICE_API_KEYS", "shared-overlap-key,lane-b")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).toThrowError(
      /must not share key values/,
    )
  })

  it("boots clean with disjoint pool and ai-chat lane CSVs", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "pool-a")
    vi.stubEnv("AI_CHAT_SERVICE_API_KEYS", "lane-a")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).not.toThrow()
  })

  it("refuses boot when devotional approval shares a pool key", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "pool-a,shared-key")
    vi.stubEnv("DEVOTIONAL_APPROVAL_API_KEYS", "shared-key,approval-a")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).toThrowError(
      /DEVOTIONAL_APPROVAL_API_KEYS.*must not share key values/,
    )
  })

  it("refuses boot when devotional playback shares a mutation key", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "pool-a")
    vi.stubEnv("DEVOTIONAL_APPROVAL_API_KEYS", "approval-a")
    vi.stubEnv("DEVOTIONAL_PLAYBACK_API_KEYS", "approval-a")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).toThrowError(
      /DEVOTIONAL_PLAYBACK_API_KEYS.*must not share key values/,
    )
  })

  it("requires service keys in production runtime", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY", "admin-exp-key")
    vi.stubEnv("ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY", "admin-ingest-key")
    vi.stubEnv(
      "ADMIN_EXPERIENCE_INGEST_URL",
      "https://admin.internal/api/internal/mastra/experience-embeddings",
    )
    vi.stubEnv(
      "ADMIN_TRANSCRIPT_INGEST_URL",
      "https://admin.internal/api/internal/mastra/transcript-embeddings",
    )
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres:postgres@localhost:5432/forge_mastra_gateway",
    )
    vi.stubEnv("MASTRA_STORAGE_DIR", "/data/mastra")
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "")
    vi.stubEnv("MASTRA_CONTENT_EMBEDDINGS_PROVIDER_MODE", "legacy")
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
    vi.stubEnv(
      "ADMIN_EXPERIENCE_INGEST_URL",
      "https://admin.internal/api/internal/mastra/experience-embeddings",
    )
    vi.stubEnv(
      "ADMIN_TRANSCRIPT_INGEST_URL",
      "https://admin.internal/api/internal/mastra/transcript-embeddings",
    )
    vi.stubEnv("DATABASE_URL", "")
    vi.stubEnv("MASTRA_STORAGE_DIR", "/data/mastra")
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "test-service-key")
    vi.stubEnv("MASTRA_CONTENT_EMBEDDINGS_PROVIDER_MODE", "legacy")
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
    vi.stubEnv(
      "ADMIN_EXPERIENCE_INGEST_URL",
      "https://admin.internal/api/internal/mastra/experience-embeddings",
    )
    vi.stubEnv(
      "ADMIN_TRANSCRIPT_INGEST_URL",
      "https://admin.internal/api/internal/mastra/transcript-embeddings",
    )
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres:postgres@localhost:5432/forge_mastra_gateway",
    )
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "test-service-key")
    vi.stubEnv("MASTRA_STORAGE_DIR", "")
    vi.stubEnv("MASTRA_CONTENT_EMBEDDINGS_PROVIDER_MODE", "legacy")
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).not.toThrow()
  })

  it("defaults Firecrawl config and stays optional in development", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test-key")
    vi.stubEnv("FIRECRAWL_API_URL", "")
    vi.stubEnv("FIRECRAWL_TIMEOUT_MS", "")

    const { getFirecrawlConfig } = await import("./env")

    expect(getFirecrawlConfig()).toEqual({
      apiKey: "fc-test-key",
      apiUrl: "https://api.firecrawl.dev",
      timeoutMs: 60_000,
      userAgent: "forge-mastra-firecrawl/1.0",
      maxSearchResults: 5,
      maxMarkdownCharacters: 16_000,
    })
  })

  it("requires Firecrawl credentials in production runtime", async () => {
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
    vi.stubEnv("MASTRA_CONTENT_EMBEDDINGS_PROVIDER_MODE", "legacy")
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")
    vi.stubEnv("FIRECRAWL_API_KEY", "")

    const { assertMastraRuntimeEnv, getFirecrawlConfig } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).toThrow(
      "FIRECRAWL_API_KEY required for Mastra production",
    )
    expect(getFirecrawlConfig().apiKey).toBeUndefined()
  })

  it("defaults YouTube config and stays optional in development", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("YOUTUBE_API_KEY", "yt-test-key")
    vi.stubEnv("YOUTUBE_API_BASE_URL", "")
    vi.stubEnv("YOUTUBE_SEARCH_TIMEOUT_MS", "")

    const { getYouTubeConfig } = await import("./env")

    expect(getYouTubeConfig()).toEqual({
      apiKey: "yt-test-key",
      baseUrl: "https://www.googleapis.com/youtube/v3",
      timeoutMs: 30_000,
    })
  })

  it("leaves the YouTube API key undefined when unset", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("YOUTUBE_API_KEY", "")

    const { getYouTubeConfig } = await import("./env")

    expect(getYouTubeConfig().apiKey).toBeUndefined()
  })

  it("keeps support research disabled and bounded when unconfigured", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("SUPPORT_RESEARCH_ENABLED", "")
    vi.stubEnv("SUPPORT_RESEARCH_PROVIDER_APPROVED", "")
    vi.stubEnv("HELP_SCOUT_CLIENT_ID", "")
    vi.stubEnv("LINEAR_SUPPORT_RESEARCH_API_KEY", "")

    const { getSupportResearchConfig } = await import("./env")

    expect(getSupportResearchConfig()).toMatchObject({
      enabled: false,
      providerApproved: false,
      model: "openai/gpt-5.4-mini",
      allowedWatchHosts: [],
      maxConversations: 200,
      maxThreadsPerConversation: 20,
      maxSanitizedCharacters: 12_000,
      maxActionsPerRun: 5,
      retentionDays: 90,
      helpScout: {
        clientId: undefined,
        mailboxIds: [],
      },
      linear: { apiKey: undefined },
    })
  })

  it("parses support research routing without exposing secret values", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("SUPPORT_RESEARCH_ENABLED", "true")
    vi.stubEnv("SUPPORT_RESEARCH_PROVIDER_APPROVED", "true")
    vi.stubEnv(
      "SUPPORT_RESEARCH_WATCH_ALLOWED_HOSTS",
      "WWW.JESUSFILM.ORG, watch.example.org",
    )
    vi.stubEnv("HELP_SCOUT_CLIENT_ID", "help-id")
    vi.stubEnv("HELP_SCOUT_CLIENT_SECRET", "help-secret")
    vi.stubEnv("HELP_SCOUT_MAILBOX_IDS", "10, 20")
    vi.stubEnv("LINEAR_SUPPORT_RESEARCH_API_KEY", "linear-secret")
    vi.stubEnv("LINEAR_SUPPORT_RESEARCH_TEAM_ID", "team-id")
    vi.stubEnv("LINEAR_SUPPORT_RESEARCH_PROJECT_ID", "project-id")

    const { getSupportResearchConfig } = await import("./env")
    const config = getSupportResearchConfig()

    expect(config.enabled).toBe(true)
    expect(config.providerApproved).toBe(true)
    expect(config.allowedWatchHosts).toEqual([
      "www.jesusfilm.org",
      "watch.example.org",
    ])
    expect(config.helpScout.mailboxIds).toEqual(["10", "20"])
    expect(config.helpScout.clientSecret).toBe("help-secret")
    expect(config.linear.apiKey).toBe("linear-secret")
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

  it("keeps production search eval baseline imports disabled by default", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MASTRA_SEARCH_EVAL_ALLOW_PROD_IMPORT", "")

    const { env } = await import("./env")

    expect(env.MASTRA_SEARCH_EVAL_ALLOW_PROD_IMPORT).toBe("false")
  })

  it("uses the Railway volume mount path for storage when present", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("MASTRA_STORAGE_DIR", "")
    vi.stubEnv("RAILWAY_VOLUME_MOUNT_PATH", "/data/")

    const { getMastraStorageDir } = await import("./env")

    expect(getMastraStorageDir()).toBe("/data/mastra")
  })

  it("defaults transcript and experience embedding model and provider settings", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_ALLOWED_HOSTS", "")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_BASE_URL", "")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_MODEL", "")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_PROVIDER", "")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_TIMEOUT_MS", "")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_USER_AGENT", "")
    vi.stubEnv("FIRECRAWL_ALLOWED_HOSTS", "")
    vi.stubEnv("FIRECRAWL_API_KEY", "")
    vi.stubEnv("FIRECRAWL_API_URL", "")
    vi.stubEnv("FIRECRAWL_MAX_MARKDOWN_CHARS", "")
    vi.stubEnv("FIRECRAWL_MAX_SEARCH_RESULTS", "")
    vi.stubEnv("FIRECRAWL_TIMEOUT_MS", "")
    vi.stubEnv("FIRECRAWL_USER_AGENT", "")
    vi.stubEnv("MASTRA_CONTENT_EMBEDDINGS_PROVIDER_MODE", "")
    vi.stubEnv("TRANSCRIPT_EMBEDDING_MODEL", "")
    vi.stubEnv("TRANSCRIPT_EMBEDDING_PROVIDER", "")
    vi.stubEnv("EXPERIENCE_EMBEDDING_MODEL", "")
    vi.stubEnv("EXPERIENCE_EMBEDDING_PROVIDER", "")
    vi.stubEnv("EVAL_QUERY_GENERATION_MODEL", "")
    vi.stubEnv("SUBTITLE_ENRICHMENT_MODEL", "")
    vi.stubEnv("SUBTITLE_ENRICHMENT_TIMEOUT_MS", "")
    vi.stubEnv("SUBTITLE_ENRICHMENT_CONCURRENCY", "")
    vi.stubEnv("OPENAI_EMBEDDINGS_BASE_URL", "")
    vi.stubEnv("OPENROUTER_EMBEDDINGS_BASE_URL", "")

    const { env } = await import("./env")

    expect(env.TRANSCRIPT_EMBEDDING_MODEL).toBe("openai/text-embedding-3-small")
    expect(env.TRANSCRIPT_EMBEDDING_PROVIDER).toBe("openai")
    expect(env.EXPERIENCE_EMBEDDING_MODEL).toBe("openai/text-embedding-3-small")
    expect(env.EXPERIENCE_EMBEDDING_PROVIDER).toBe("openai")
    expect(env.EVAL_QUERY_GENERATION_MODEL).toBe("anthropic/claude-haiku-4-5")
    expect(env.SUBTITLE_ENRICHMENT_MODEL).toBe("google/gemini-2.5-flash")
    expect(env.SUBTITLE_ENRICHMENT_TIMEOUT_MS).toBe(120_000)
    expect(env.SUBTITLE_ENRICHMENT_CONCURRENCY).toBe(10)
    expect(env.AI_GATEWAY_EMBEDDINGS_ALLOWED_HOSTS).toBe(
      "ai-gateway.jesusfilm.org",
    )
    expect(env.AI_GATEWAY_EMBEDDINGS_BASE_URL).toBe(
      "https://ai-gateway.jesusfilm.org/v1",
    )
    expect(env.AI_GATEWAY_EMBEDDINGS_MODEL).toBe("embeddings")
    expect(env.AI_GATEWAY_EMBEDDINGS_PROVIDER).toBe("jesus-film-ai-gateway")
    expect(env.AI_GATEWAY_EMBEDDINGS_TIMEOUT_MS).toBe(60_000)
    expect(env.AI_GATEWAY_EMBEDDINGS_USER_AGENT).toBe(
      "forge-mastra-content-embeddings/1.0",
    )
    expect(env.FIRECRAWL_ALLOWED_HOSTS).toBe("api.firecrawl.dev")
    expect(env.FIRECRAWL_API_KEY).toBeUndefined()
    expect(env.FIRECRAWL_API_URL).toBe("https://api.firecrawl.dev")
    expect(env.FIRECRAWL_MAX_MARKDOWN_CHARS).toBe(16_000)
    expect(env.FIRECRAWL_MAX_SEARCH_RESULTS).toBe(5)
    expect(env.FIRECRAWL_TIMEOUT_MS).toBe(60_000)
    expect(env.FIRECRAWL_USER_AGENT).toBe("forge-mastra-firecrawl/1.0")
    expect(env.OPENAI_EMBEDDINGS_BASE_URL).toBe("https://api.openai.com/v1")
    expect(env.OPENROUTER_EMBEDDINGS_BASE_URL).toBe(
      "https://openrouter.ai/api/v1",
    )
  })

  it("passes the AI Gateway embedding timeout through provider config", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MASTRA_CONTENT_EMBEDDINGS_PROVIDER_MODE", "gateway")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_API_KEY", "gateway-key")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_TIMEOUT_MS", "90000")

    const { getTranscriptEmbeddingProviderConfig } = await import("./env")

    expect(getTranscriptEmbeddingProviderConfig()).toMatchObject({
      provider: "jesus-film-ai-gateway",
      timeoutMs: 90_000,
    })
  })

  it("passes Firecrawl settings through provider config", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("FIRECRAWL_API_KEY", "custom-firecrawl-key")
    vi.stubEnv("FIRECRAWL_API_URL", "https://firecrawl.internal")
    vi.stubEnv("FIRECRAWL_TIMEOUT_MS", "45000")
    vi.stubEnv("FIRECRAWL_USER_AGENT", "forge-test-firecrawl/1.0")
    vi.stubEnv("FIRECRAWL_MAX_SEARCH_RESULTS", "7")
    vi.stubEnv("FIRECRAWL_MAX_MARKDOWN_CHARS", "9000")

    const { getFirecrawlConfig } = await import("./env")

    expect(getFirecrawlConfig()).toEqual({
      apiKey: "custom-firecrawl-key",
      apiUrl: "https://firecrawl.internal",
      timeoutMs: 45_000,
      userAgent: "forge-test-firecrawl/1.0",
      maxSearchResults: 7,
      maxMarkdownCharacters: 9000,
    })
  })

  it("requires AI Gateway credentials in production runtime by default", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY", "admin-exp-key")
    vi.stubEnv("ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY", "admin-ingest-key")
    vi.stubEnv(
      "ADMIN_EXPERIENCE_INGEST_URL",
      "https://admin.internal/api/internal/mastra/experience-embeddings",
    )
    vi.stubEnv(
      "ADMIN_TRANSCRIPT_INGEST_URL",
      "https://admin.internal/api/internal/mastra/transcript-embeddings",
    )
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres:postgres@localhost:5432/forge_mastra_gateway",
    )
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "test-service-key")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_API_KEY", "")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).toThrow(
      "AI_GATEWAY_EMBEDDINGS_API_KEY required for Mastra production",
    )
  })

  it("requires Firecrawl credentials in production runtime", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY", "admin-exp-key")
    vi.stubEnv("ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY", "admin-ingest-key")
    vi.stubEnv(
      "ADMIN_EXPERIENCE_INGEST_URL",
      "https://admin.internal/api/internal/mastra/experience-embeddings",
    )
    vi.stubEnv(
      "ADMIN_TRANSCRIPT_INGEST_URL",
      "https://admin.internal/api/internal/mastra/transcript-embeddings",
    )
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres:postgres@localhost:5432/forge_mastra_gateway",
    )
    vi.stubEnv("FIRECRAWL_API_KEY", "")
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "test-service-key")
    vi.stubEnv("MASTRA_CONTENT_EMBEDDINGS_PROVIDER_MODE", "legacy")
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).toThrow(
      "FIRECRAWL_API_KEY required for Mastra production",
    )
  })

  it("rejects unsafe Firecrawl API URLs in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY", "admin-exp-key")
    vi.stubEnv("ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY", "admin-ingest-key")
    vi.stubEnv(
      "ADMIN_EXPERIENCE_INGEST_URL",
      "https://admin.internal/api/internal/mastra/experience-embeddings",
    )
    vi.stubEnv(
      "ADMIN_TRANSCRIPT_INGEST_URL",
      "https://admin.internal/api/internal/mastra/transcript-embeddings",
    )
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres:postgres@localhost:5432/forge_mastra_gateway",
    )
    vi.stubEnv("FIRECRAWL_API_URL", "http://evil.test")
    vi.stubEnv("FIRECRAWL_ALLOWED_HOSTS", "api.firecrawl.dev")
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "test-service-key")
    vi.stubEnv("MASTRA_CONTENT_EMBEDDINGS_PROVIDER_MODE", "legacy")
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).toThrow(
      "FIRECRAWL_API_URL must use https and a host listed in FIRECRAWL_ALLOWED_HOSTS for Mastra production",
    )
  })

  it("rejects non-allowlisted Firecrawl API hosts in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY", "admin-exp-key")
    vi.stubEnv("ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY", "admin-ingest-key")
    vi.stubEnv(
      "ADMIN_EXPERIENCE_INGEST_URL",
      "https://admin.internal/api/internal/mastra/experience-embeddings",
    )
    vi.stubEnv(
      "ADMIN_TRANSCRIPT_INGEST_URL",
      "https://admin.internal/api/internal/mastra/transcript-embeddings",
    )
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres:postgres@localhost:5432/forge_mastra_gateway",
    )
    vi.stubEnv("FIRECRAWL_API_URL", "https://other.test")
    vi.stubEnv("FIRECRAWL_ALLOWED_HOSTS", "api.firecrawl.dev")
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "test-service-key")
    vi.stubEnv("MASTRA_CONTENT_EMBEDDINGS_PROVIDER_MODE", "legacy")
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).toThrow(
      "FIRECRAWL_API_URL must use https and a host listed in FIRECRAWL_ALLOWED_HOSTS for Mastra production",
    )
  })

  it("uses legacy OpenRouter credentials for embedding provider config in local mode", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_API_KEY", "")
    vi.stubEnv("MASTRA_CONTENT_EMBEDDINGS_PROVIDER_MODE", "legacy")
    vi.stubEnv("OPENAI_API_KEY", "openai-key")
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")

    const {
      getExperienceEmbeddingProviderConfig,
      getTranscriptEmbeddingProviderConfig,
    } = await import("./env")

    expect(getTranscriptEmbeddingProviderConfig()).toEqual({
      apiKey: "openrouter-key",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/text-embedding-3-small",
      provider: "openai",
    })
    expect(getExperienceEmbeddingProviderConfig()).toEqual({
      apiKey: "openrouter-key",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/text-embedding-3-small",
      provider: "openai",
    })
  })

  it("prefers OPENROUTER_API_PAID_KEY for legacy OpenRouter embedding config", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_API_KEY", "")
    vi.stubEnv("MASTRA_CONTENT_EMBEDDINGS_PROVIDER_MODE", "legacy")
    vi.stubEnv("OPENAI_API_KEY", "openai-key")
    vi.stubEnv("OPENROUTER_API_PAID_KEY", "paid-openrouter-key")
    vi.stubEnv("OPENROUTER_API_KEY", "legacy-openrouter-key")

    const { getOpenRouterApiKey, getTranscriptEmbeddingProviderConfig } =
      await import("./env")

    expect(getOpenRouterApiKey()).toBe("paid-openrouter-key")
    expect(getTranscriptEmbeddingProviderConfig()).toEqual({
      apiKey: "paid-openrouter-key",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/text-embedding-3-small",
      provider: "openai",
    })
  })

  it("prefers AI Gateway config for content embedding provider config", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_API_KEY", "gateway-key")
    vi.stubEnv(
      "AI_GATEWAY_EMBEDDINGS_BASE_URL",
      "https://ai-gateway.jesusfilm.org/v1",
    )
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_MODEL", "embeddings")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_PROVIDER", "jesus-film-ai-gateway")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_USER_AGENT", "forge-test/1.0")
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")

    const {
      getContentEmbeddingsProviderMode,
      getExperienceEmbeddingProviderConfig,
      getTranscriptEmbeddingProviderConfig,
    } = await import("./env")

    expect(getContentEmbeddingsProviderMode()).toBe("gateway")
    const expected = {
      apiKey: "gateway-key",
      baseUrl: "https://ai-gateway.jesusfilm.org/v1",
      model: "embeddings",
      provider: "jesus-film-ai-gateway",
      userAgent: "forge-test/1.0",
      timeoutMs: 60_000,
      expectedNativeDimensions: 1536,
    }
    expect(getTranscriptEmbeddingProviderConfig()).toEqual(expected)
    expect(getExperienceEmbeddingProviderConfig()).toEqual(expected)
  })

  it("keeps transform config for a future 4096-native gateway variant", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_API_KEY", "gateway-key")
    vi.stubEnv(
      "AI_GATEWAY_EMBEDDINGS_BASE_URL",
      "https://ai-gateway.jesusfilm.org/v1",
    )
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_MODEL", "embeddings")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_PROVIDER", "jesus-film-ai-gateway")

    vi.doMock("../services/embedding-provider", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("../services/embedding-provider")>()
      return {
        ...actual,
        EXPECTED_AI_GATEWAY_EMBEDDING_NATIVE_DIMENSIONS: 4096,
        EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS: 1536,
      }
    })

    const { getTranscriptEmbeddingProviderConfig } = await import("./env")

    expect(getTranscriptEmbeddingProviderConfig()).toMatchObject({
      provider: "jesus-film-ai-gateway",
      model: "embeddings",
      expectedNativeDimensions: 4096,
      truncateToDimensions: 1536,
      transformVersion: "matryoshka-truncate-1536-v1",
    })
  })

  it("allows explicit legacy content embedding mode in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY", "admin-exp-key")
    vi.stubEnv("ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY", "admin-ingest-key")
    vi.stubEnv(
      "ADMIN_EXPERIENCE_INGEST_URL",
      "https://admin.internal/api/internal/mastra/experience-embeddings",
    )
    vi.stubEnv(
      "ADMIN_TRANSCRIPT_INGEST_URL",
      "https://admin.internal/api/internal/mastra/transcript-embeddings",
    )
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres:postgres@localhost:5432/forge_mastra_gateway",
    )
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "test-service-key")
    vi.stubEnv("MASTRA_CONTENT_EMBEDDINGS_PROVIDER_MODE", "legacy")
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_API_KEY", "")

    const { assertMastraRuntimeEnv, getContentEmbeddingsProviderMode } =
      await import("./env")

    expect(getContentEmbeddingsProviderMode()).toBe("legacy")
    expect(() => assertMastraRuntimeEnv()).not.toThrow()
  })

  it("rejects unsafe AI Gateway base URLs in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY", "admin-exp-key")
    vi.stubEnv("ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY", "admin-ingest-key")
    vi.stubEnv(
      "ADMIN_EXPERIENCE_INGEST_URL",
      "https://admin.internal/api/internal/mastra/experience-embeddings",
    )
    vi.stubEnv(
      "ADMIN_TRANSCRIPT_INGEST_URL",
      "https://admin.internal/api/internal/mastra/transcript-embeddings",
    )
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres:postgres@localhost:5432/forge_mastra_gateway",
    )
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "test-service-key")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_API_KEY", "gateway-key")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_BASE_URL", "http://evil.test/v1")
    vi.stubEnv(
      "AI_GATEWAY_EMBEDDINGS_ALLOWED_HOSTS",
      "ai-gateway.jesusfilm.org",
    )

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).toThrow(
      "AI_GATEWAY_EMBEDDINGS_BASE_URL must use https and a host listed in AI_GATEWAY_EMBEDDINGS_ALLOWED_HOSTS for Mastra production",
    )
  })

  it("rejects non-allowlisted AI Gateway hosts in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY", "admin-exp-key")
    vi.stubEnv("ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY", "admin-ingest-key")
    vi.stubEnv(
      "ADMIN_EXPERIENCE_INGEST_URL",
      "https://admin.internal/api/internal/mastra/experience-embeddings",
    )
    vi.stubEnv(
      "ADMIN_TRANSCRIPT_INGEST_URL",
      "https://admin.internal/api/internal/mastra/transcript-embeddings",
    )
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres:postgres@localhost:5432/forge_mastra_gateway",
    )
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "test-service-key")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_API_KEY", "gateway-key")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_BASE_URL", "https://other.test/v1")
    vi.stubEnv(
      "AI_GATEWAY_EMBEDDINGS_ALLOWED_HOSTS",
      "ai-gateway.jesusfilm.org",
    )

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).toThrow(
      "AI_GATEWAY_EMBEDDINGS_BASE_URL must use https and a host listed in AI_GATEWAY_EMBEDDINGS_ALLOWED_HOSTS for Mastra production",
    )
  })

  it("rejects unexpected AI Gateway embedding models in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY", "admin-exp-key")
    vi.stubEnv("ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY", "admin-ingest-key")
    vi.stubEnv(
      "ADMIN_EXPERIENCE_INGEST_URL",
      "https://admin.internal/api/internal/mastra/experience-embeddings",
    )
    vi.stubEnv(
      "ADMIN_TRANSCRIPT_INGEST_URL",
      "https://admin.internal/api/internal/mastra/transcript-embeddings",
    )
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres:postgres@localhost:5432/forge_mastra_gateway",
    )
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "test-service-key")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_API_KEY", "gateway-key")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_MODEL", "other-embeddings")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).toThrow(
      "AI_GATEWAY_EMBEDDINGS_MODEL and AI_GATEWAY_EMBEDDINGS_PROVIDER must match the approved production content embedding contract",
    )
  })

  it("rejects unexpected AI Gateway embedding providers in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY", "admin-exp-key")
    vi.stubEnv("ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY", "admin-ingest-key")
    vi.stubEnv(
      "ADMIN_EXPERIENCE_INGEST_URL",
      "https://admin.internal/api/internal/mastra/experience-embeddings",
    )
    vi.stubEnv(
      "ADMIN_TRANSCRIPT_INGEST_URL",
      "https://admin.internal/api/internal/mastra/transcript-embeddings",
    )
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres:postgres@localhost:5432/forge_mastra_gateway",
    )
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "test-service-key")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_API_KEY", "gateway-key")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_PROVIDER", "other-provider")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).toThrow(
      "AI_GATEWAY_EMBEDDINGS_MODEL and AI_GATEWAY_EMBEDDINGS_PROVIDER must match the approved production content embedding contract",
    )
  })

  it("exposes configured devotional site-ingest, partners, and video search", async () => {
    vi.stubEnv(
      "DEVOTIONAL_SITE_INGEST_URL",
      "https://watch.example.org/api/devotional-ingest",
    )
    vi.stubEnv("DEVOTIONAL_SITE_INGEST_API_KEY", "devotional-ingest-key")
    vi.stubEnv("DEVOTIONAL_PARTNER_DOMAINS", "Partner.org, gotquestions.org ,")
    vi.stubEnv("DEVOTIONAL_DEFAULT_VIDEO_ID", "video-fallback-1")
    vi.stubEnv("DEVOTIONAL_MODEL", "anthropic/claude-sonnet-4-6")
    vi.stubEnv("DEVOTIONAL_SAFETY_MODEL", "anthropic/claude-opus-4-8")
    vi.stubEnv(
      "ADMIN_SEARCH_EVAL_SEARCH_URL",
      "https://admin.internal/api/internal/search-eval/search",
    )
    vi.stubEnv("ADMIN_SEARCH_EVAL_API_KEY", "search-eval-key")

    const {
      getDevotionalSiteIngestConfig,
      getDevotionalPartnerDomains,
      getDevotionalVideoSearchConfig,
      getDevotionalModel,
      getDevotionalSafetyModel,
    } = await import("./env")

    expect(getDevotionalSiteIngestConfig()).toEqual({
      url: "https://watch.example.org/api/devotional-ingest",
      apiKey: "devotional-ingest-key",
    })
    expect(getDevotionalPartnerDomains()).toEqual([
      "partner.org",
      "gotquestions.org",
    ])
    expect(getDevotionalVideoSearchConfig()).toEqual({
      url: "https://admin.internal/api/internal/search-eval/search",
      bearer: "search-eval-key",
      defaultVideoId: "video-fallback-1",
    })
    expect(getDevotionalModel()).toBe("anthropic/claude-sonnet-4-6")
    expect(getDevotionalSafetyModel()).toBe("anthropic/claude-opus-4-8")
  })

  it("defaults devotional config when optional vars are unset", async () => {
    const {
      getDevotionalSiteIngestConfig,
      getDevotionalPartnerDomains,
      getDevotionalVideoSearchConfig,
      getDevotionalModel,
      getDevotionalSafetyModel,
    } = await import("./env")

    expect(getDevotionalSiteIngestConfig()).toEqual({
      url: undefined,
      apiKey: undefined,
    })
    expect(getDevotionalPartnerDomains()).toEqual([])
    expect(getDevotionalVideoSearchConfig().defaultVideoId).toBeUndefined()
    expect(getDevotionalModel()).toBe("anthropic/claude-haiku-4-5")
    expect(getDevotionalSafetyModel()).toBe("anthropic/claude-haiku-4-5")
  })

  // --- feat-199: JESUSFILM_RAG_* optional config + production host guard ---

  // Stub the full required production set so RAG-guard tests isolate the RAG
  // var behavior (a missing unrelated required var would otherwise mask it).
  function stubProductionBaseline() {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY", "admin-exp-key")
    vi.stubEnv("ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY", "admin-ingest-key")
    vi.stubEnv(
      "ADMIN_EXPERIENCE_INGEST_URL",
      "https://admin.internal/api/internal/mastra/experience-embeddings",
    )
    vi.stubEnv(
      "ADMIN_TRANSCRIPT_INGEST_URL",
      "https://admin.internal/api/internal/mastra/transcript-embeddings",
    )
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres:postgres@localhost:5432/forge_mastra_gateway",
    )
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "test-service-key")
    vi.stubEnv("MASTRA_CONTENT_EMBEDDINGS_PROVIDER_MODE", "legacy")
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")
  }

  it.each([
    {
      name: "all settings are absent",
      ingestUrl: "",
      sourcesUrl: "",
      token: "",
    },
    {
      name: "only the review-queue URL is set",
      ingestUrl: "https://site.internal/api/review-queue",
      sourcesUrl: "",
      token: "",
    },
    {
      name: "only the saved-sources URL is set",
      ingestUrl: "",
      sourcesUrl: "https://site.internal/api/discovery-sources",
      token: "",
    },
    {
      name: "only the shared bearer is set",
      ingestUrl: "",
      sourcesUrl: "",
      token: "discovery-token",
    },
  ])(
    "boots production when $name",
    async ({ ingestUrl, sourcesUrl, token }) => {
      stubProductionBaseline()
      vi.stubEnv("INSTAGRAM_DISCOVERY_SITE_INGEST_URL", ingestUrl)
      vi.stubEnv("DISCOVERY_SOURCES_URL", sourcesUrl)
      vi.stubEnv("INSTAGRAM_DISCOVERY_SITE_INGEST_TOKEN", token)

      const {
        assertMastraRuntimeEnv,
        getDiscoverySiteIngestConfig,
        getDiscoverySourcesConfig,
      } = await import("./env")

      expect(() => assertMastraRuntimeEnv()).not.toThrow()
      expect(getDiscoverySiteIngestConfig()).toBeNull()
      expect(getDiscoverySourcesConfig()).toBeNull()
    },
  )

  it.each([
    {
      name: "only the review-queue endpoint is active",
      ingestUrl: "https://site.internal/api/review-queue",
      sourcesUrl: "",
      expectedIngest: {
        url: "https://site.internal/api/review-queue",
        token: "discovery-token",
      },
      expectedSources: null,
    },
    {
      name: "only the saved-sources endpoint is active",
      ingestUrl: "",
      sourcesUrl: "https://site.internal/api/discovery-sources",
      expectedIngest: null,
      expectedSources: {
        url: "https://site.internal/api/discovery-sources",
        token: "discovery-token",
      },
    },
    {
      name: "endpoint syntax is invalid",
      ingestUrl: "not a URL",
      sourcesUrl: "http://site.internal/api/discovery-sources",
      expectedIngest: {
        url: "not a URL",
        token: "discovery-token",
      },
      expectedSources: {
        url: "http://site.internal/api/discovery-sources",
        token: "discovery-token",
      },
    },
  ])(
    "boots production without a host allowlist when $name",
    async ({ ingestUrl, sourcesUrl, expectedIngest, expectedSources }) => {
      stubProductionBaseline()
      vi.stubEnv("INSTAGRAM_DISCOVERY_SITE_INGEST_URL", ingestUrl)
      vi.stubEnv("DISCOVERY_SOURCES_URL", sourcesUrl)
      vi.stubEnv("INSTAGRAM_DISCOVERY_SITE_INGEST_TOKEN", "discovery-token")

      const {
        assertMastraRuntimeEnv,
        getDiscoverySiteIngestConfig,
        getDiscoverySourcesConfig,
      } = await import("./env")

      expect(() => assertMastraRuntimeEnv()).not.toThrow()
      expect(getDiscoverySiteIngestConfig()).toEqual(expectedIngest)
      expect(getDiscoverySourcesConfig()).toEqual(expectedSources)
    },
  )

  it("imports cleanly with all RAG vars unset (no boot failure)", async () => {
    vi.stubEnv("NODE_ENV", "development")

    const { env, getJesusfilmRagConfig } = await import("./env")

    // The Railway-brick regression gate: a fresh deploy with no RAG vars boots.
    expect(env.JESUSFILM_RAG_BASE_URL).toBeUndefined()
    expect(env.JESUSFILM_RAG_API_KEY).toBeUndefined()
    expect(env.JESUSFILM_RAG_ALLOWED_HOSTS).toBeUndefined()
    expect(getJesusfilmRagConfig()).toEqual({
      baseUrl: undefined,
      apiKey: undefined,
      timeoutMs: 5_000,
      userAgent: "forge-mastra-jesusfilm-rag/1.0",
      // feat-202: `.optional()` knob falls back to the 2 MiB default at the
      // accessor — no boot requirement, so a fresh deploy still gets a cap.
      maxResponseBytes: 2_097_152,
    })
  })

  it("treats an empty-string RAG base URL as unset (no url() boot failure)", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("JESUSFILM_RAG_BASE_URL", "")
    vi.stubEnv("JESUSFILM_RAG_TIMEOUT_MS", "")
    vi.stubEnv("JESUSFILM_RAG_USER_AGENT", "")

    const { env, getJesusfilmRagConfig } = await import("./env")

    expect(env.JESUSFILM_RAG_BASE_URL).toBeUndefined()
    // Defaults apply when unset.
    expect(getJesusfilmRagConfig().timeoutMs).toBe(5_000)
    expect(getJesusfilmRagConfig().userAgent).toBe(
      "forge-mastra-jesusfilm-rag/1.0",
    )
  })

  it("projects all RAG fields through getJesusfilmRagConfig when set", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("JESUSFILM_RAG_BASE_URL", "https://rag.internal")
    vi.stubEnv("JESUSFILM_RAG_API_KEY", "rag-key")
    vi.stubEnv("JESUSFILM_RAG_ALLOWED_HOSTS", "rag.internal")
    vi.stubEnv("JESUSFILM_RAG_TIMEOUT_MS", "2500")
    vi.stubEnv("JESUSFILM_RAG_USER_AGENT", "forge-test-rag/9.9")
    // feat-202: prove the optional byte-cap override projects through (coerced
    // from string), not just the accessor default.
    vi.stubEnv("JESUSFILM_RAG_MAX_RESPONSE_BYTES", "1048576")

    const { getJesusfilmRagConfig } = await import("./env")

    expect(getJesusfilmRagConfig()).toEqual({
      baseUrl: "https://rag.internal",
      apiKey: "rag-key",
      timeoutMs: 2_500,
      userAgent: "forge-test-rag/9.9",
      maxResponseBytes: 1_048_576,
    })
  })

  it("skips the RAG host guard in production when the base URL is unset", async () => {
    stubProductionBaseline()
    // No JESUSFILM_RAG_* vars set at all.

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).not.toThrow()
  })

  it("rejects an http RAG base URL in production", async () => {
    stubProductionBaseline()
    vi.stubEnv("JESUSFILM_RAG_BASE_URL", "http://rag.internal")
    vi.stubEnv("JESUSFILM_RAG_ALLOWED_HOSTS", "rag.internal")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).toThrow(
      "JESUSFILM_RAG_BASE_URL must use https and a host listed in JESUSFILM_RAG_ALLOWED_HOSTS for Mastra production",
    )
  })

  it("rejects a RAG host absent from the allowlist in production", async () => {
    stubProductionBaseline()
    vi.stubEnv("JESUSFILM_RAG_BASE_URL", "https://other.test")
    vi.stubEnv("JESUSFILM_RAG_ALLOWED_HOSTS", "rag.internal")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).toThrow(
      "JESUSFILM_RAG_BASE_URL must use https and a host listed in JESUSFILM_RAG_ALLOWED_HOSTS for Mastra production",
    )
  })

  it("rejects a set RAG base URL with no allowlist in production (fail-closed)", async () => {
    stubProductionBaseline()
    vi.stubEnv("JESUSFILM_RAG_BASE_URL", "https://rag.internal")
    // JESUSFILM_RAG_ALLOWED_HOSTS deliberately unset.

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).toThrow(
      "JESUSFILM_RAG_BASE_URL must use https and a host listed in JESUSFILM_RAG_ALLOWED_HOSTS for Mastra production",
    )
  })

  it("accepts an https RAG base URL whose host is allowlisted in production", async () => {
    stubProductionBaseline()
    vi.stubEnv("JESUSFILM_RAG_BASE_URL", "https://rag.internal")
    vi.stubEnv("JESUSFILM_RAG_ALLOWED_HOSTS", "rag.internal")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).not.toThrow()
  })

  it("does not throw on an unsafe RAG base URL outside production", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("JESUSFILM_RAG_BASE_URL", "http://rag.internal")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).not.toThrow()
  })

  it("boots in production with the RAG base URL+allowlist set but the API key absent", async () => {
    // Confirms the allowlist throw and the key-degradation paths are
    // independent: a valid allowlisted base URL with no key boots fine; the
    // client returns config_missing at runtime (covered in U2).
    stubProductionBaseline()
    vi.stubEnv("JESUSFILM_RAG_BASE_URL", "https://rag.internal")
    vi.stubEnv("JESUSFILM_RAG_ALLOWED_HOSTS", "rag.internal")
    // JESUSFILM_RAG_API_KEY deliberately unset.

    const { assertMastraRuntimeEnv, getJesusfilmRagConfig } =
      await import("./env")

    expect(() => assertMastraRuntimeEnv()).not.toThrow()
    expect(getJesusfilmRagConfig().apiKey).toBeUndefined()
  })

  it("rejects a RAG timeout above the schema cap at parse", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("JESUSFILM_RAG_TIMEOUT_MS", "30001")

    await expect(import("./env")).rejects.toThrow()
  })

  it("rejects a RAG max-response-bytes above the 16 MiB schema cap at parse", async () => {
    // Fail LOUD on an over-range operator typo rather than silently widening the
    // OOM guard. 16_777_217 is one byte over the 16 MiB ceiling.
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("JESUSFILM_RAG_MAX_RESPONSE_BYTES", "16777217")

    await expect(import("./env")).rejects.toThrow()
  })

  // --- feat-204: SEEKER_ROUTE_ENABLED default-off string-boolean gate (KTD7) ---

  it("disables the seeker route when SEEKER_ROUTE_ENABLED is unset", async () => {
    vi.stubEnv("NODE_ENV", "development")

    const { isSeekerRouteEnabled } = await import("./env")

    expect(isSeekerRouteEnabled()).toBe(false)
  })

  it('treats SEEKER_ROUTE_ENABLED="false" as disabled (not JS-truthy)', async () => {
    // The load-bearing guard against JS truthiness inverting the safety default:
    // a naive `Boolean(env.SEEKER_ROUTE_ENABLED)` would enable on "false".
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("SEEKER_ROUTE_ENABLED", "false")

    const { isSeekerRouteEnabled } = await import("./env")

    expect(isSeekerRouteEnabled()).toBe(false)
  })

  it('enables the seeker route only when SEEKER_ROUTE_ENABLED is exactly "true"', async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("SEEKER_ROUTE_ENABLED", "true")

    const { isSeekerRouteEnabled } = await import("./env")

    expect(isSeekerRouteEnabled()).toBe(true)
  })

  it("keeps SEEKER_ROUTE_ENABLED out of the production required-var set (optional at boot)", async () => {
    // The route flag must NEVER brick a Railway deploy: a fully-provisioned
    // production env with SEEKER_ROUTE_ENABLED unset still boots.
    stubProductionBaseline()
    // SEEKER_ROUTE_ENABLED deliberately unset.

    const { assertMastraRuntimeEnv, isSeekerRouteEnabled } =
      await import("./env")

    expect(() => assertMastraRuntimeEnv()).not.toThrow()
    expect(isSeekerRouteEnabled()).toBe(false)
  })

  // --- feat-237: AI_GATEWAY_SEEKER_ENABLED default-off string-boolean gate ---

  it("disables the seeker gateway model when AI_GATEWAY_SEEKER_ENABLED is unset", async () => {
    vi.stubEnv("NODE_ENV", "development")

    const { isAiGatewaySeekerEnabled } = await import("./env")

    expect(isAiGatewaySeekerEnabled()).toBe(false)
  })

  it('treats AI_GATEWAY_SEEKER_ENABLED="false" as disabled (not JS-truthy)', async () => {
    // The load-bearing guard against JS truthiness inverting the safety default:
    // a naive `Boolean(env.AI_GATEWAY_SEEKER_ENABLED)` would enable on "false".
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("AI_GATEWAY_SEEKER_ENABLED", "false")

    const { isAiGatewaySeekerEnabled } = await import("./env")

    expect(isAiGatewaySeekerEnabled()).toBe(false)
  })

  it('treats AI_GATEWAY_SEEKER_ENABLED="TRUE" as disabled (exact-match only)', async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("AI_GATEWAY_SEEKER_ENABLED", "TRUE")

    const { isAiGatewaySeekerEnabled } = await import("./env")

    expect(isAiGatewaySeekerEnabled()).toBe(false)
  })

  it('treats AI_GATEWAY_SEEKER_ENABLED="1" as disabled (exact-match only)', async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("AI_GATEWAY_SEEKER_ENABLED", "1")

    const { isAiGatewaySeekerEnabled } = await import("./env")

    expect(isAiGatewaySeekerEnabled()).toBe(false)
  })

  it('enables the seeker gateway model only when AI_GATEWAY_SEEKER_ENABLED is exactly "true"', async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("AI_GATEWAY_SEEKER_ENABLED", "true")

    const { isAiGatewaySeekerEnabled } = await import("./env")

    expect(isAiGatewaySeekerEnabled()).toBe(true)
  })

  it("keeps AI_GATEWAY_SEEKER_ENABLED out of the production required-var set (optional at boot)", async () => {
    // The flag must NEVER brick a Railway deploy: a fully-provisioned
    // production env with AI_GATEWAY_SEEKER_ENABLED unset still boots.
    stubProductionBaseline()
    // AI_GATEWAY_SEEKER_ENABLED deliberately unset.

    const { assertMastraRuntimeEnv, isAiGatewaySeekerEnabled } =
      await import("./env")

    expect(() => assertMastraRuntimeEnv()).not.toThrow()
    expect(isAiGatewaySeekerEnabled()).toBe(false)
  })

  // --- feat-208: AI_CHAT_MEMORY_BACKEND kill-switch precedence ---

  it("resolves the ai-chat backend to MASTRA_STORAGE_BACKEND (postgres default) when the override is unset", async () => {
    vi.stubEnv("NODE_ENV", "development")
    // AI_CHAT_MEMORY_BACKEND unset; MASTRA_STORAGE_BACKEND defaults to postgres.

    const { resolveAiChatMemoryBackend } = await import("./env")

    expect(resolveAiChatMemoryBackend()).toBe("postgres")
  })

  it("follows MASTRA_STORAGE_BACKEND=memory when the override is unset", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MASTRA_STORAGE_BACKEND", "memory")

    const { resolveAiChatMemoryBackend } = await import("./env")

    expect(resolveAiChatMemoryBackend()).toBe("memory")
  })

  it("lets AI_CHAT_MEMORY_BACKEND=memory override postgres runtime storage (the kill-switch)", async () => {
    // The documented no-code-deploy revert: ai-chat runs in-memory even while
    // the runtime store stays postgres. `??` precedence must pick the override.
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MASTRA_STORAGE_BACKEND", "postgres")
    vi.stubEnv("AI_CHAT_MEMORY_BACKEND", "memory")

    const { resolveAiChatMemoryBackend } = await import("./env")

    expect(resolveAiChatMemoryBackend()).toBe("memory")
  })

  it("honors AI_CHAT_MEMORY_BACKEND=postgres explicitly over a memory runtime store", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MASTRA_STORAGE_BACKEND", "memory")
    vi.stubEnv("AI_CHAT_MEMORY_BACKEND", "postgres")

    const { resolveAiChatMemoryBackend } = await import("./env")

    expect(resolveAiChatMemoryBackend()).toBe("postgres")
  })

  // --- feat-208: retention purge gating — canAiChatDataPersist ---

  it("reports persisted ai-chat data possible under the postgres default", async () => {
    vi.stubEnv("NODE_ENV", "development")
    // Both backends unset; MASTRA_STORAGE_BACKEND defaults to postgres.

    const { canAiChatDataPersist } = await import("./env")

    expect(canAiChatDataPersist()).toBe(true)
  })

  it("reports no persistence for a pure memory-backend local run", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MASTRA_STORAGE_BACKEND", "memory")

    const { canAiChatDataPersist } = await import("./env")

    expect(canAiChatDataPersist()).toBe(false)
  })

  it("keeps retention eligible under the kill-switch (ai-chat memory over postgres runtime)", async () => {
    // THE load-bearing case: engaging the kill-switch stops WRITES, but rows
    // already persisted in ai_chat must keep aging out — the purge gate must
    // stay open whenever postgres is configured at all.
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MASTRA_STORAGE_BACKEND", "postgres")
    vi.stubEnv("AI_CHAT_MEMORY_BACKEND", "memory")

    const { canAiChatDataPersist } = await import("./env")

    expect(canAiChatDataPersist()).toBe(true)
  })

  it("reports persistence for the explicit ai-chat postgres override over a memory runtime", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MASTRA_STORAGE_BACKEND", "memory")
    vi.stubEnv("AI_CHAT_MEMORY_BACKEND", "postgres")

    const { canAiChatDataPersist } = await import("./env")

    expect(canAiChatDataPersist()).toBe(true)
  })

  // --- Langfuse prompt helper (U1): LANGFUSE_* optional config + production host guard ---

  it("imports cleanly with all Langfuse vars unset (no boot failure)", async () => {
    vi.stubEnv("NODE_ENV", "development")

    const { env, getLangfuseConfig } = await import("./env")

    // The Railway-brick regression gate: a fresh deploy with no Langfuse vars boots.
    expect(env.LANGFUSE_BASE_URL).toBeUndefined()
    expect(env.LANGFUSE_PUBLIC_KEY).toBeUndefined()
    expect(env.LANGFUSE_SECRET_KEY).toBeUndefined()
    expect(env.LANGFUSE_ALLOWED_HOSTS).toBeUndefined()
    expect(getLangfuseConfig()).toEqual({
      baseUrl: undefined,
      publicKey: undefined,
      secretKey: undefined,
      timeoutMs: 3_000,
      userAgent: "forge-mastra-langfuse/1.0",
      // `.optional()` knob falls back to the 256 KiB default at the accessor —
      // no boot requirement, so a fresh deploy still gets a cap.
      maxResponseBytes: 262_144,
      promptDefaultLabel: undefined,
      promptCacheTtlMs: 60_000,
      promptFailureCooldownMs: 10_000,
    })
  })

  it("clamps a Langfuse failure cooldown above the cache TTL to the TTL (smaller wins)", async () => {
    // Invariant: the effective failure cooldown never exceeds the effective
    // TTL, whatever the operator configured — a cooldown outliving the cache
    // window would keep serving the fallback after a fresh fetch is due.
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("LANGFUSE_PROMPT_CACHE_TTL_MS", "30000")
    vi.stubEnv("LANGFUSE_PROMPT_FAILURE_COOLDOWN_MS", "45000")

    const { getLangfuseConfig } = await import("./env")

    expect(getLangfuseConfig().promptCacheTtlMs).toBe(30_000)
    expect(getLangfuseConfig().promptFailureCooldownMs).toBe(30_000)
  })

  it("skips the Langfuse host guard in production when the base URL is unset", async () => {
    stubProductionBaseline()
    // No LANGFUSE_* vars set at all.

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).not.toThrow()
  })

  it("rejects an http Langfuse base URL in production", async () => {
    stubProductionBaseline()
    vi.stubEnv("LANGFUSE_BASE_URL", "http://langfuse.internal")
    vi.stubEnv("LANGFUSE_ALLOWED_HOSTS", "langfuse.internal")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).toThrow(
      "LANGFUSE_BASE_URL must use https and a host listed in LANGFUSE_ALLOWED_HOSTS for Mastra production",
    )
  })

  it("rejects a Langfuse host absent from the allowlist in production", async () => {
    stubProductionBaseline()
    vi.stubEnv("LANGFUSE_BASE_URL", "https://other.test")
    vi.stubEnv("LANGFUSE_ALLOWED_HOSTS", "langfuse.internal")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).toThrow(
      "LANGFUSE_BASE_URL must use https and a host listed in LANGFUSE_ALLOWED_HOSTS for Mastra production",
    )
  })

  it("rejects a set Langfuse base URL with no allowlist in production (fail-closed)", async () => {
    stubProductionBaseline()
    vi.stubEnv("LANGFUSE_BASE_URL", "https://langfuse.internal")
    // LANGFUSE_ALLOWED_HOSTS deliberately unset.

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).toThrow(
      "LANGFUSE_BASE_URL must use https and a host listed in LANGFUSE_ALLOWED_HOSTS for Mastra production",
    )
  })

  it("accepts an https Langfuse base URL whose host is allowlisted in production", async () => {
    stubProductionBaseline()
    vi.stubEnv("LANGFUSE_BASE_URL", "https://langfuse.internal")
    vi.stubEnv("LANGFUSE_ALLOWED_HOSTS", "langfuse.internal")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).not.toThrow()
  })

  it("does not throw on an unsafe Langfuse base URL outside production", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("LANGFUSE_BASE_URL", "http://langfuse.internal")

    const { assertMastraRuntimeEnv } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).not.toThrow()
  })

  it("treats empty-string Langfuse values as unset (no url() boot failure)", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("LANGFUSE_BASE_URL", "")
    vi.stubEnv("LANGFUSE_TIMEOUT_MS", "")
    vi.stubEnv("LANGFUSE_USER_AGENT", "")
    // An empty string must not trip the `z.enum(["1"])` smoke gate either.
    vi.stubEnv("LANGFUSE_PROMPT_SMOKE_TEST", "")

    const { env, getLangfuseConfig } = await import("./env")

    expect(env.LANGFUSE_BASE_URL).toBeUndefined()
    expect(env.LANGFUSE_PROMPT_SMOKE_TEST).toBeUndefined()
    // Defaults apply when unset.
    expect(getLangfuseConfig().timeoutMs).toBe(3_000)
    expect(getLangfuseConfig().userAgent).toBe("forge-mastra-langfuse/1.0")
  })

  it("projects all Langfuse fields through getLangfuseConfig when set", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("LANGFUSE_BASE_URL", "https://langfuse.internal")
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-lf-test")
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-lf-test")
    vi.stubEnv("LANGFUSE_ALLOWED_HOSTS", "langfuse.internal")
    vi.stubEnv("LANGFUSE_TIMEOUT_MS", "2500")
    vi.stubEnv("LANGFUSE_USER_AGENT", "forge-test-langfuse/9.9")
    // Prove the optional byte-cap override projects through (coerced from
    // string), not just the accessor default.
    vi.stubEnv("LANGFUSE_MAX_RESPONSE_BYTES", "131072")
    vi.stubEnv("LANGFUSE_PROMPT_DEFAULT_LABEL", "production")
    // Cooldown below the TTL: projected verbatim, no clamping.
    vi.stubEnv("LANGFUSE_PROMPT_CACHE_TTL_MS", "120000")
    vi.stubEnv("LANGFUSE_PROMPT_FAILURE_COOLDOWN_MS", "20000")

    const { getLangfuseConfig } = await import("./env")

    expect(getLangfuseConfig()).toEqual({
      baseUrl: "https://langfuse.internal",
      publicKey: "pk-lf-test",
      secretKey: "sk-lf-test",
      timeoutMs: 2_500,
      userAgent: "forge-test-langfuse/9.9",
      maxResponseBytes: 131_072,
      promptDefaultLabel: "production",
      promptCacheTtlMs: 120_000,
      promptFailureCooldownMs: 20_000,
    })
  })

  it("boots in production with the Langfuse base URL+allowlist set but the keys absent", async () => {
    // Confirms the allowlist throw and the key-degradation paths are
    // independent: a valid allowlisted base URL with no keys boots fine; the
    // helper serves the caller-supplied fallback at runtime (covered in U2+).
    stubProductionBaseline()
    vi.stubEnv("LANGFUSE_BASE_URL", "https://langfuse.internal")
    vi.stubEnv("LANGFUSE_ALLOWED_HOSTS", "langfuse.internal")
    // LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY deliberately unset.

    const { assertMastraRuntimeEnv, getLangfuseConfig } = await import("./env")

    expect(() => assertMastraRuntimeEnv()).not.toThrow()
    expect(getLangfuseConfig().publicKey).toBeUndefined()
    expect(getLangfuseConfig().secretKey).toBeUndefined()
  })

  it("rejects a Langfuse timeout above the schema cap at parse", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("LANGFUSE_TIMEOUT_MS", "10001")

    await expect(import("./env")).rejects.toThrow()
  })

  it("rejects a Langfuse prompt cache TTL above the schema cap at parse", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("LANGFUSE_PROMPT_CACHE_TTL_MS", "3600001")

    await expect(import("./env")).rejects.toThrow()
  })

  it("rejects a Langfuse failure cooldown above the schema cap at parse", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("LANGFUSE_PROMPT_FAILURE_COOLDOWN_MS", "300001")

    await expect(import("./env")).rejects.toThrow()
  })

  it("rejects a Langfuse max-response-bytes above the 5 MiB schema cap at parse", async () => {
    // Fail LOUD on an over-range operator typo rather than silently widening
    // the OOM guard. 5_242_881 is one byte over the 5 MiB ceiling.
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("LANGFUSE_MAX_RESPONSE_BYTES", "5242881")

    await expect(import("./env")).rejects.toThrow()
  })

  it('accepts LANGFUSE_PROMPT_SMOKE_TEST="1" (the only enabling literal)', async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("LANGFUSE_PROMPT_SMOKE_TEST", "1")

    const { env } = await import("./env")

    expect(env.LANGFUSE_PROMPT_SMOKE_TEST).toBe("1")
  })

  it('rejects a non-"1" LANGFUSE_PROMPT_SMOKE_TEST at parse', async () => {
    // The enum fails loud on "true"/"yes"/etc. rather than silently
    // half-enabling the smoke gate.
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("LANGFUSE_PROMPT_SMOKE_TEST", "true")

    await expect(import("./env")).rejects.toThrow()
  })

  it("defaults the devotional Workspace to a local directory and bounded SQL pool", async () => {
    vi.stubEnv("NODE_ENV", "test")
    vi.stubEnv("MASTRA_STORAGE_DIR", ".tmp/mastra")
    vi.stubEnv("DEVOTIONAL_WORKSPACE_LOCAL_DIR", "")
    vi.stubEnv("DEVOTIONAL_WORKSPACE_DATABASE_POOL_MAX", "")

    const { getDevotionalWorkspaceEnvironment } = await import("./env")

    expect(getDevotionalWorkspaceEnvironment()).toMatchObject({
      nodeEnv: "test",
      localDirectory: ".tmp/mastra/devotional-workspace",
      prefix: "devotional",
      databasePoolMax: 3,
      s3: {},
    })
  })

  it("keeps the dedicated devotional S3 tuple separate from generic artifact storage", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("RAILWAY_S3_BUCKET", "generic-artifacts")
    vi.stubEnv("DEVOTIONAL_WORKSPACE_S3_BUCKET", "devotional-content")
    vi.stubEnv(
      "DEVOTIONAL_WORKSPACE_S3_ENDPOINT",
      "https://objects.example.test",
    )
    vi.stubEnv("DEVOTIONAL_WORKSPACE_S3_REGION", "auto")
    vi.stubEnv("DEVOTIONAL_WORKSPACE_S3_ACCESS_KEY_ID", "access")
    vi.stubEnv("DEVOTIONAL_WORKSPACE_S3_SECRET_ACCESS_KEY", "secret")

    const { env, getDevotionalWorkspaceEnvironment } = await import("./env")

    expect(getDevotionalWorkspaceEnvironment().s3.bucket).toBe(
      "devotional-content",
    )
    expect(env.RAILWAY_S3_BUCKET).toBe("generic-artifacts")
  })

  it("rejects a devotional direct SQL pool above its service budget", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("DEVOTIONAL_WORKSPACE_DATABASE_POOL_MAX", "4")

    await expect(import("./env")).rejects.toThrow()
  })

  it("rejects a one-connection devotional pool that would self-deadlock", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("DEVOTIONAL_WORKSPACE_DATABASE_POOL_MAX", "1")

    await expect(import("./env")).rejects.toThrow()
  })
})
