import { beforeEach, describe, expect, it, vi } from "vitest"

// Partial env mock (mirrors seeker-agent.test.ts): overrides ONLY `env` and
// the seeker gateway resolver; everything else comes from the real module via
// importOriginal. The real resolver's exact-`"true"` semantics stay pinned by
// config/env.test.ts.
const mockEnv = vi.hoisted(() => ({
  env: {
    AI_GATEWAY_CHAT_API_KEY: undefined as string | undefined,
    AI_GATEWAY_CHAT_ALLOWED_HOSTS: undefined as string | undefined,
    AI_GATEWAY_CHAT_BASE_URL: undefined as string | undefined,
    AI_GATEWAY_CHAT_MODEL: undefined as string | undefined,
    AI_GATEWAY_SEEKER_ENABLED: undefined as string | undefined,
  },
}))

vi.mock("../config/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config/env")>()),
  env: mockEnv.env,
  // Call-time read so per-test mutation of mockEnv takes effect.
  isAiGatewaySeekerEnabled: () =>
    mockEnv.env.AI_GATEWAY_SEEKER_ENABLED === "true",
}))

import {
  buildSeekerGatewayModelEntry,
  buildSeekerModelList,
} from "./seeker-model-list"

// Today's free-Gemma OpenRouter chain — the disabled branch must return
// EXACTLY this (same ids, same order, same maxRetries). Behavior pin across
// the feat-405 U1 extraction from seeker-agent.ts.
const GEMMA_FALLBACK_CHAIN = [
  { model: "openrouter/google/gemma-4-31b-it:free", maxRetries: 1 },
  { model: "openrouter/google/gemma-4-26b-a4b-it:free", maxRetries: 1 },
]

beforeEach(() => {
  mockEnv.env.AI_GATEWAY_CHAT_API_KEY = undefined
  mockEnv.env.AI_GATEWAY_CHAT_ALLOWED_HOSTS = undefined
  mockEnv.env.AI_GATEWAY_CHAT_BASE_URL = undefined
  mockEnv.env.AI_GATEWAY_CHAT_MODEL = undefined
  mockEnv.env.AI_GATEWAY_SEEKER_ENABLED = undefined
  vi.restoreAllMocks()
})

describe("buildSeekerModelList (leaf module, feat-405 U1)", () => {
  // Shape-only assertions on purpose: constructing the provider makes no
  // network call; the live smoke checklist is the real-contract gate.

  it("returns exactly today's two-entry Gemma chain when nothing is set", () => {
    expect(buildSeekerModelList()).toEqual(GEMMA_FALLBACK_CHAIN)
  })

  it("prepends the gateway entry (maxRetries 0) when the key AND flag are set", () => {
    mockEnv.env.AI_GATEWAY_CHAT_API_KEY = "sk-test"
    mockEnv.env.AI_GATEWAY_SEEKER_ENABLED = "true"

    const models = buildSeekerModelList()

    expect(models).toHaveLength(3)
    expect(typeof models[0]?.model).not.toBe("string")
    const gatewayModel = models[0]?.model as {
      modelId: string
      provider: string
    }
    expect(gatewayModel.modelId).toBe("coding")
    expect(gatewayModel.provider).toBe("jesusfilm.chat")
    // 0 retries on the gateway entry — the Gemma chain IS the retry.
    expect(models[0]?.maxRetries).toBe(0)
    expect(models.slice(1)).toEqual(GEMMA_FALLBACK_CHAIN)
  })

  it("keeps the Gemma-only chain when the key is set but the flag is not", () => {
    mockEnv.env.AI_GATEWAY_CHAT_API_KEY = "sk-test"
    expect(buildSeekerModelList()).toEqual(GEMMA_FALLBACK_CHAIN)
  })

  it("keeps the Gemma-only chain, without throwing, when the flag is on but the key is unset", () => {
    mockEnv.env.AI_GATEWAY_SEEKER_ENABLED = "true"
    expect(buildSeekerModelList()).toEqual(GEMMA_FALLBACK_CHAIN)
  })
})

describe("buildSeekerGatewayModelEntry (feat-405 U1, KTD4 key-presence rule)", () => {
  it("returns null when the gateway key is unset", () => {
    expect(buildSeekerGatewayModelEntry()).toBeNull()
  })

  it("returns null when the key is unset even with the seeker flag on", () => {
    mockEnv.env.AI_GATEWAY_SEEKER_ENABLED = "true"
    expect(buildSeekerGatewayModelEntry()).toBeNull()
  })

  it("returns the gateway entry when the key is set, regardless of the seeker flag", () => {
    // KTD4 rationale: AI_GATEWAY_SEEKER_ENABLED is feat-237's seeker
    // incident-rollback lever; the sweep's gateway availability keys on the
    // key's presence ALONE so a seeker rollback cannot disable title repair.
    mockEnv.env.AI_GATEWAY_CHAT_API_KEY = "sk-test"

    for (const flag of [undefined, "false", "true"] as const) {
      mockEnv.env.AI_GATEWAY_SEEKER_ENABLED = flag
      const entry = buildSeekerGatewayModelEntry()
      expect(entry).not.toBeNull()
      expect(entry?.maxRetries).toBe(0)
    }
  })

  it("resolves the model id from AI_GATEWAY_CHAT_MODEL ?? 'coding' — never a Gemma id — with the flag unset", () => {
    // Discriminating case for the U1 approach note: with the seeker flag OFF,
    // `identity.models.routes[0]` is a free-Gemma id. Deriving the entry's
    // model from there would silently point the sweep's gateway calls at a
    // model the gateway does not serve. The entry must key on the env override
    // with the "coding" default instead.
    mockEnv.env.AI_GATEWAY_CHAT_API_KEY = "sk-test"

    const defaultEntry = buildSeekerGatewayModelEntry()
    const defaultModel = defaultEntry?.model as {
      modelId: string
      provider: string
    }
    expect(defaultModel.modelId).toBe("coding")
    expect(defaultModel.provider).toBe("jesusfilm.chat")
    expect(defaultModel.modelId).not.toContain("gemma")

    mockEnv.env.AI_GATEWAY_CHAT_MODEL = "custom"
    const overriddenEntry = buildSeekerGatewayModelEntry()
    const overriddenModel = overriddenEntry?.model as { modelId: string }
    expect(overriddenModel.modelId).toBe("custom")
  })
})

describe("buildSeekerGatewayModelEntry (feat-440 host-allowlist defense-in-depth)", () => {
  // The real `isAllowedAiGatewayChatBaseUrl` runs here (the module mock
  // spreads importOriginal), fed by the mocked env fields — so these cases
  // exercise the true rule at the choke point, not a stub of it. The boot
  // assert in config/env.ts is the primary enforcement; this layer covers
  // entrypoints that never run assertMastraRuntimeEnv.

  it("returns null (with one enum-only warn) on an unlisted https host", () => {
    mockEnv.env.AI_GATEWAY_CHAT_API_KEY = "sk-test"
    mockEnv.env.AI_GATEWAY_CHAT_BASE_URL = "https://other.example/v1"
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    expect(buildSeekerGatewayModelEntry()).toBeNull()

    expect(warn).toHaveBeenCalledTimes(1)
    const line = warn.mock.calls[0]?.[0] as string
    expect(line).toBe("[seeker-gateway] event=gateway_base_url_not_allowed")
    // Leak pin: the config URL/host never reaches the log line.
    expect(line).not.toContain("other.example")
  })

  it("returns null on an http base URL even for the default host", () => {
    mockEnv.env.AI_GATEWAY_CHAT_API_KEY = "sk-test"
    mockEnv.env.AI_GATEWAY_CHAT_BASE_URL = "http://ai-gateway.jesusfilm.org/v1"
    vi.spyOn(console, "warn").mockImplementation(() => {})

    expect(buildSeekerGatewayModelEntry()).toBeNull()
  })

  it("returns the entry for a custom https host listed in the allowlist", () => {
    // Anti-vacuous companion: the same custom host that nulls above passes
    // once allowlisted, proving the null came from the list — not the
    // non-default URL.
    mockEnv.env.AI_GATEWAY_CHAT_API_KEY = "sk-test"
    mockEnv.env.AI_GATEWAY_CHAT_BASE_URL = "https://other.example/v1"
    mockEnv.env.AI_GATEWAY_CHAT_ALLOWED_HOSTS = "other.example"

    const entry = buildSeekerGatewayModelEntry()

    expect(entry).not.toBeNull()
    expect(entry?.maxRetries).toBe(0)
  })

  it("degrades buildSeekerModelList to the Gemma-only chain when the gateway URL is disallowed", () => {
    // The seeker/titling counted degrade: flag on + key set would normally
    // prepend the gateway entry; a disallowed URL must fall back to exactly
    // today's chain instead of throwing or silently keeping the gateway.
    mockEnv.env.AI_GATEWAY_CHAT_API_KEY = "sk-test"
    mockEnv.env.AI_GATEWAY_SEEKER_ENABLED = "true"
    mockEnv.env.AI_GATEWAY_CHAT_BASE_URL = "https://other.example/v1"
    vi.spyOn(console, "warn").mockImplementation(() => {})

    expect(buildSeekerModelList()).toEqual(GEMMA_FALLBACK_CHAIN)
  })
})
