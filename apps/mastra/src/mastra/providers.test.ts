import { beforeEach, describe, expect, it, vi } from "vitest"

const mockEnv = vi.hoisted(() => ({
  env: {
    OPENROUTER_API_KEY: undefined as string | undefined,
    OPENAI_API_KEY: undefined as string | undefined,
    OPENAI_BASE_URL: undefined as string | undefined,
    OLLAMA_BASE_URL: undefined as string | undefined,
    AI_GATEWAY_CHAT_BASE_URL: undefined as string | undefined,
    AI_GATEWAY_CHAT_API_KEY: undefined as string | undefined,
    AI_GATEWAY_CHAT_MODEL: undefined as string | undefined,
    AI_GATEWAY_EMBEDDINGS_API_KEY: undefined as string | undefined,
    AI_GATEWAY_EMBEDDINGS_MODEL: undefined as string | undefined,
    MASTRA_DEFAULT_PROVIDER: undefined as
      | "openrouter"
      | "ollama"
      | "openai"
      | "anthropic"
      | "jesusfilm"
      | undefined,
  },
}))

vi.mock("../config/env", () => mockEnv)

describe("apps/mastra/src/mastra/providers", () => {
  beforeEach(() => {
    mockEnv.env.OPENROUTER_API_KEY = undefined
    mockEnv.env.OPENAI_API_KEY = undefined
    mockEnv.env.OPENAI_BASE_URL = undefined
    mockEnv.env.OLLAMA_BASE_URL = undefined
    mockEnv.env.AI_GATEWAY_CHAT_BASE_URL = undefined
    mockEnv.env.AI_GATEWAY_CHAT_API_KEY = undefined
    mockEnv.env.AI_GATEWAY_CHAT_MODEL = undefined
    mockEnv.env.AI_GATEWAY_EMBEDDINGS_API_KEY = undefined
    mockEnv.env.AI_GATEWAY_EMBEDDINGS_MODEL = undefined
    mockEnv.env.MASTRA_DEFAULT_PROVIDER = undefined
    vi.resetModules()
  })

  describe("DEFAULT_PROVIDER_ID", () => {
    it("falls back to openrouter when MASTRA_DEFAULT_PROVIDER is unset", async () => {
      const { DEFAULT_PROVIDER_ID } = await import("./providers")
      expect(DEFAULT_PROVIDER_ID).toBe("openrouter")
    })

    it("respects MASTRA_DEFAULT_PROVIDER when set", async () => {
      mockEnv.env.MASTRA_DEFAULT_PROVIDER = "ollama"
      const { DEFAULT_PROVIDER_ID } = await import("./providers")
      expect(DEFAULT_PROVIDER_ID).toBe("ollama")
    })
  })

  describe("getProvider", () => {
    describe("openrouter", () => {
      it("returns a ModelFactory when OPENROUTER_API_KEY is set", async () => {
        mockEnv.env.OPENROUTER_API_KEY = "test-key"
        const { getProvider } = await import("./providers")
        const factory = getProvider("openrouter")
        expect(typeof factory).toBe("function")
        // Calling the factory returns an AI SDK language model; we
        // don't invoke it (no network in tests), just confirm the
        // call shape compiles and produces an object.
        const model = factory("openai/gpt-5.4")
        expect(model).toBeDefined()
      })

      it("throws ProviderNotConfiguredError when OPENROUTER_API_KEY is unset", async () => {
        const { getProvider, ProviderNotConfiguredError } =
          await import("./providers")
        expect(() => getProvider("openrouter")).toThrowError(
          ProviderNotConfiguredError,
        )
      })

      it("error carries provider id and the missing env var name", async () => {
        const { getProvider, ProviderNotConfiguredError } =
          await import("./providers")
        try {
          getProvider("openrouter")
          expect.fail("expected ProviderNotConfiguredError")
        } catch (error) {
          expect(error).toBeInstanceOf(ProviderNotConfiguredError)
          if (error instanceof ProviderNotConfiguredError) {
            expect(error.providerId).toBe("openrouter")
            expect(error.missingEnv).toBe("OPENROUTER_API_KEY")
          }
        }
      })
    })

    describe("ollama", () => {
      it("returns a ModelFactory with no env required (uses default base URL)", async () => {
        const { getProvider } = await import("./providers")
        const factory = getProvider("ollama")
        expect(typeof factory).toBe("function")
        const model = factory("gemma4:e4b")
        expect(model).toBeDefined()
      })

      it("honours OLLAMA_BASE_URL when set", async () => {
        mockEnv.env.OLLAMA_BASE_URL = "http://custom-host:11434/api"
        const { getProvider } = await import("./providers")
        // Construct factory — assertion is that no env-validation
        // path throws; the URL gets baked into the provider instance.
        expect(() => getProvider("ollama")).not.toThrow()
      })
    })

    describe("openai", () => {
      it("returns a ModelFactory when OPENAI_API_KEY is set", async () => {
        mockEnv.env.OPENAI_API_KEY = "test-key"
        const { getProvider } = await import("./providers")
        const factory = getProvider("openai")
        expect(typeof factory).toBe("function")
      })

      it("throws ProviderNotConfiguredError when OPENAI_API_KEY is unset", async () => {
        const { getProvider, ProviderNotConfiguredError } =
          await import("./providers")
        expect(() => getProvider("openai")).toThrowError(
          ProviderNotConfiguredError,
        )
      })
    })

    describe("jesusfilm", () => {
      it("returns a ModelFactory when AI_GATEWAY_CHAT_API_KEY is set", async () => {
        mockEnv.env.AI_GATEWAY_CHAT_API_KEY = "test-key"
        const { getProvider } = await import("./providers")
        const factory = getProvider("jesusfilm")
        expect(typeof factory).toBe("function")
        const model = factory("coding")
        expect(model).toBeDefined()
      })

      it("uses AI_GATEWAY_CHAT_MODEL / base URL overrides without throwing", async () => {
        mockEnv.env.AI_GATEWAY_CHAT_API_KEY = "test-key"
        mockEnv.env.AI_GATEWAY_CHAT_BASE_URL = "https://gw.example.test/v1"
        mockEnv.env.AI_GATEWAY_CHAT_MODEL = "coding-pro"
        const { getProvider } = await import("./providers")
        expect(() => getProvider("jesusfilm")("coding-pro")).not.toThrow()
      })

      it("throws ProviderNotConfiguredError when AI_GATEWAY_CHAT_API_KEY is unset", async () => {
        const { getProvider, ProviderNotConfiguredError } =
          await import("./providers")
        expect(() => getProvider("jesusfilm")).toThrowError(
          ProviderNotConfiguredError,
        )
      })

      it("does NOT route chat through the gateway when only the embedding key is set", async () => {
        // The chat branch keys on AI_GATEWAY_CHAT_API_KEY specifically,
        // so enabling embeddings alone must not satisfy the chat provider.
        mockEnv.env.AI_GATEWAY_EMBEDDINGS_API_KEY = "embed-only-key"
        const { getProvider, ProviderNotConfiguredError } =
          await import("./providers")
        expect(() => getProvider("jesusfilm")).toThrowError(
          ProviderNotConfiguredError,
        )
      })

      it("error carries provider id and the missing chat env var name", async () => {
        const { getProvider, ProviderNotConfiguredError } =
          await import("./providers")
        try {
          getProvider("jesusfilm")
          expect.fail("expected ProviderNotConfiguredError")
        } catch (error) {
          expect(error).toBeInstanceOf(ProviderNotConfiguredError)
          if (error instanceof ProviderNotConfiguredError) {
            expect(error.providerId).toBe("jesusfilm")
            expect(error.missingEnv).toBe("AI_GATEWAY_CHAT_API_KEY")
          }
        }
      })
    })

    describe("anthropic", () => {
      it("throws ProviderNotConfiguredError (not yet installed)", async () => {
        const { getProvider, ProviderNotConfiguredError } =
          await import("./providers")
        try {
          getProvider("anthropic")
          expect.fail("expected ProviderNotConfiguredError")
        } catch (error) {
          expect(error).toBeInstanceOf(ProviderNotConfiguredError)
          if (error instanceof ProviderNotConfiguredError) {
            expect(error.providerId).toBe("anthropic")
          }
        }
      })
    })

    describe("unknown provider id", () => {
      it("throws UnknownProviderError for an id outside the union", async () => {
        const { getProvider, UnknownProviderError } =
          await import("./providers")
        // Bypass the type system to test runtime exhaustiveness.
        const badId = "totally-not-a-provider" as unknown as Parameters<
          typeof getProvider
        >[0]
        expect(() => getProvider(badId)).toThrowError(UnknownProviderError)
      })
    })
  })

  describe("isJesusFilmEmbeddingConfigured", () => {
    it("is false when no gateway key is set", async () => {
      const { isJesusFilmEmbeddingConfigured } = await import("./providers")
      expect(isJesusFilmEmbeddingConfigured()).toBe(false)
    })

    it("is true when the embedding key is set", async () => {
      mockEnv.env.AI_GATEWAY_EMBEDDINGS_API_KEY = "embed-key"
      const { isJesusFilmEmbeddingConfigured } = await import("./providers")
      expect(isJesusFilmEmbeddingConfigured()).toBe(true)
    })

    it("is FALSE when only the chat key is set (model-scoped: chat key cannot embed)", async () => {
      // Regression guard: a chat-key fallback would silently enable
      // semantic recall and then 403 on every embed call, because the
      // gateway's `coding` key is rejected by the `embeddings` model.
      mockEnv.env.AI_GATEWAY_CHAT_API_KEY = "chat-key"
      const { isJesusFilmEmbeddingConfigured } = await import("./providers")
      expect(isJesusFilmEmbeddingConfigured()).toBe(false)
    })
  })

  describe("getJesusFilmEmbeddingModel", () => {
    it("builds an embedding model when the embedding key is set", async () => {
      mockEnv.env.AI_GATEWAY_EMBEDDINGS_API_KEY = "embed-key"
      const { getJesusFilmEmbeddingModel } = await import("./providers")
      expect(getJesusFilmEmbeddingModel()).toBeDefined()
    })

    it("throws when only the chat key is set (no chat-key fallback — model-scoped)", async () => {
      // The chat (`coding`) key cannot access the embeddings model, so
      // it must NOT satisfy the embedding provider.
      mockEnv.env.AI_GATEWAY_CHAT_API_KEY = "chat-key"
      const { getJesusFilmEmbeddingModel, ProviderNotConfiguredError } =
        await import("./providers")
      expect(() => getJesusFilmEmbeddingModel()).toThrowError(
        ProviderNotConfiguredError,
      )
    })

    it("throws ProviderNotConfiguredError naming the embedding key when neither key is set", async () => {
      const { getJesusFilmEmbeddingModel, ProviderNotConfiguredError } =
        await import("./providers")
      try {
        getJesusFilmEmbeddingModel()
        expect.fail("expected ProviderNotConfiguredError")
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderNotConfiguredError)
        if (error instanceof ProviderNotConfiguredError) {
          expect(error.providerId).toBe("jesusfilm")
          expect(error.missingEnv).toBe("AI_GATEWAY_EMBEDDINGS_API_KEY")
        }
      }
    })
  })
})
