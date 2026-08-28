import { afterEach, describe, expect, it, vi } from "vitest"

import { Agent, type ModelWithRetries } from "@mastra/core/agent"
import type { MastraModelConfig } from "@mastra/core/llm"
import { InMemoryStore } from "@mastra/core/storage"

import {
  __resetAiChatMemoryForTesting,
  __resetAiChatStorageForTesting,
  AI_CHAT_SCHEMA_NAME,
  aiChatMemoryConfigFor,
  buildAiChatMemory,
  getAiChatMemory,
} from "./ai-chat-memory"
import { USER_RESOURCE_PREFIX } from "./ai-chat-thread-ownership"

// ---------------------------------------------------------------------------
// Hoisted env mock. The ai-chat backend defaults to `memory` here so
// module-load construction never builds a PostgresStore unless a test flips it.
// Partial mock since feat-405 U2: the default title model resolves through the
// REAL `buildSeekerModelList` (via seeker-model-list.ts), which reads `env`
// and `isAiGatewaySeekerEnabled` — both overridden here so the titling tests
// drive the real env seam rather than injecting a chain literal.
// ---------------------------------------------------------------------------

const mockEnv = vi.hoisted(() => {
  const state = {
    env: {
      DATABASE_URL: undefined as string | undefined,
      AI_GATEWAY_CHAT_API_KEY: undefined as string | undefined,
      AI_GATEWAY_CHAT_BASE_URL: undefined as string | undefined,
      AI_GATEWAY_CHAT_MODEL: undefined as string | undefined,
      AI_GATEWAY_SEEKER_ENABLED: undefined as string | undefined,
    },
    aiChatBackend: "memory" as "postgres" | "memory",
    // Mirror the real `getMastraDatabaseUrl()`: DATABASE_URL with the local
    // fallback so resolution never returns undefined.
    getMastraDatabaseUrl: () =>
      state.env.DATABASE_URL ??
      "postgresql://postgres:postgres@localhost:5432/forge_mastra_gateway",
    resolveAiChatMemoryBackend: () => state.aiChatBackend,
    isAiGatewaySeekerEnabled: () =>
      state.env.AI_GATEWAY_SEEKER_ENABLED === "true",
  }
  return state
})

vi.mock("../config/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config/env")>()),
  env: mockEnv.env,
  getMastraDatabaseUrl: mockEnv.getMastraDatabaseUrl,
  resolveAiChatMemoryBackend: mockEnv.resolveAiChatMemoryBackend,
  isAiGatewaySeekerEnabled: mockEnv.isAiGatewaySeekerEnabled,
}))

const postgresStoreSpy = vi.hoisted(() => vi.fn())
vi.mock("@mastra/pg", async () => {
  const actual =
    await vi.importActual<typeof import("@mastra/pg")>("@mastra/pg")
  class SpyingPostgresStore extends actual.PostgresStore {
    constructor(
      options: ConstructorParameters<typeof actual.PostgresStore>[0],
    ) {
      postgresStoreSpy(options)
      super(options)
    }
  }
  return { ...actual, PostgresStore: SpyingPostgresStore }
})

// Passive constructor spy so tests can assert the options Memory receives
// (feat-241: the generateTitle wiring on BOTH ai-chat backend branches).
const memoryCtorSpy = vi.hoisted(() => vi.fn())
vi.mock("@mastra/memory", async () => {
  const actual =
    await vi.importActual<typeof import("@mastra/memory")>("@mastra/memory")
  class SpyingMemory extends actual.Memory {
    constructor(options: ConstructorParameters<typeof actual.Memory>[0]) {
      memoryCtorSpy(options)
      super(options)
    }
  }
  return { ...actual, Memory: SpyingMemory }
})

afterEach(() => {
  __resetAiChatMemoryForTesting()
  __resetAiChatStorageForTesting()
  mockEnv.aiChatBackend = "memory"
  mockEnv.env.DATABASE_URL = undefined
  mockEnv.env.AI_GATEWAY_CHAT_API_KEY = undefined
  mockEnv.env.AI_GATEWAY_CHAT_BASE_URL = undefined
  mockEnv.env.AI_GATEWAY_CHAT_MODEL = undefined
  mockEnv.env.AI_GATEWAY_SEEKER_ENABLED = undefined
  postgresStoreSpy.mockClear()
  memoryCtorSpy.mockClear()
})

// Today's free-Gemma OpenRouter chain — what the function-valued title model
// must return whenever the gateway flag or key is unset (the gate matrix's
// gateway-off rows).
const GEMMA_FALLBACK_CHAIN = [
  { model: "openrouter/google/gemma-4-31b-it:free", maxRetries: 1 },
  { model: "openrouter/google/gemma-4-26b-a4b-it:free", maxRetries: 1 },
]

describe("ai-chat memory (feat-208)", () => {
  it("returns a singleton Memory instance", () => {
    const first = getAiChatMemory()
    const second = getAiChatMemory()
    expect(first).toBe(second)
  })

  it("returns a fresh instance after __resetAiChatMemoryForTesting", () => {
    const first = getAiChatMemory()
    __resetAiChatMemoryForTesting()
    expect(getAiChatMemory()).not.toBe(first)
  })

  it("uses an InMemoryStore under the memory backend (local dev / kill-switch path)", () => {
    const memory = buildAiChatMemory({ getBackend: () => "memory" })
    expect(memory.storage).toBeInstanceOf(InMemoryStore)
    expect(postgresStoreSpy).not.toHaveBeenCalled()
  })

  it("uses a PostgresStore in the dedicated ai_chat schema under the postgres backend", () => {
    buildAiChatMemory({ getBackend: () => "postgres" })
    expect(postgresStoreSpy).toHaveBeenCalledTimes(1)
    const options = postgresStoreSpy.mock.calls[0]?.[0] as {
      schemaName?: string
      max?: number
    }
    expect(options.schemaName).toBe("ai_chat")
    expect(options.max).toBe(5)
  })

  it("keeps the ai_chat schema distinct from the mastra schema (drift guard)", () => {
    // The whole point of feat-208's schema choice: ai-chat conversations must
    // never share tables with runtime storage / experience-chat memory.
    expect(AI_CHAT_SCHEMA_NAME).toBe("ai_chat")
    expect(AI_CHAT_SCHEMA_NAME).not.toBe("mastra")
  })

  it("wires a FUNCTION-valued top-level generateTitle model on BOTH backends (feat-405, KTD1)", () => {
    // Postgres-branch wiring has no other coverage — the titling behavior
    // tests run on the memory backend only, so this pins the config shape
    // both branches hand the Memory constructor. Function-valued on purpose:
    // it defers gateway-client construction out of module load and reads
    // AI_GATEWAY_SEEKER_ENABLED per turn instead of freezing it at first
    // buildAiChatMemory() call.
    memoryCtorSpy.mockClear()
    buildAiChatMemory({ getBackend: () => "memory" })
    buildAiChatMemory({ getBackend: () => "postgres" })
    expect(memoryCtorSpy).toHaveBeenCalledTimes(2)
    for (const call of memoryCtorSpy.mock.calls) {
      const args = call[0] as {
        options?: {
          generateTitle?: { model?: unknown }
          threads?: unknown
        }
      }
      expect(typeof args.options?.generateTitle?.model).toBe("function")
      // The deprecated nesting would throw mid-turn — it must never appear.
      expect(args.options?.threads).toBeUndefined()
    }
  })

  it("title model function returns the Gemma-only seeker chain when the gateway flag is off (real env seam)", () => {
    // Exercised against the REAL env seam (the partial mock's env state), not
    // an injected literal: the default titleModel must resolve through
    // buildSeekerModelList's own gate, so a seeker incident rollback
    // (flag off) reverts titling to the free chain with no code change.
    buildAiChatMemory({ getBackend: () => "memory" })
    const args = memoryCtorSpy.mock.calls.at(-1)?.[0] as {
      options: { generateTitle: { model: () => ModelWithRetries[] } }
    }
    expect(args.options.generateTitle.model()).toEqual(GEMMA_FALLBACK_CHAIN)
  })

  it("title model function returns the gateway-first chain when the key AND flag are set (real env seam)", () => {
    mockEnv.env.AI_GATEWAY_CHAT_API_KEY = "sk-test"
    mockEnv.env.AI_GATEWAY_SEEKER_ENABLED = "true"

    buildAiChatMemory({ getBackend: () => "memory" })
    const args = memoryCtorSpy.mock.calls.at(-1)?.[0] as {
      options: { generateTitle: { model: () => ModelWithRetries[] } }
    }
    const models = args.options.generateTitle.model()
    expect(models).toHaveLength(3)
    const gatewayModel = models[0]?.model as {
      modelId: string
      provider: string
    }
    expect(gatewayModel.modelId).toBe("coding")
    expect(gatewayModel.provider).toBe("jesusfilm.chat")
    expect(models[0]?.maxRetries).toBe(0)
    expect(models.slice(1)).toEqual(GEMMA_FALLBACK_CHAIN)
  })

  it("title model function reads the flag PER CALL, not frozen at Memory construction (feat-405, KTD1)", () => {
    // The discriminating case for the function form over an eager array: the
    // Memory is built once at module load, but the flag must keep governing
    // each turn's title chain.
    buildAiChatMemory({ getBackend: () => "memory" })
    const args = memoryCtorSpy.mock.calls.at(-1)?.[0] as {
      options: { generateTitle: { model: () => ModelWithRetries[] } }
    }
    expect(args.options.generateTitle.model()).toHaveLength(2)

    mockEnv.env.AI_GATEWAY_CHAT_API_KEY = "sk-test"
    mockEnv.env.AI_GATEWAY_SEEKER_ENABLED = "true"
    expect(args.options.generateTitle.model()).toHaveLength(3)
  })

  it("still honors an injected non-function titleModel through the test seam", () => {
    // seeker-route.test.ts's titling suites inject MockLanguageModelV3
    // instances; the seam must keep accepting a plain MastraModelConfig.
    const injected = "openrouter/test/mock-model" as MastraModelConfig
    buildAiChatMemory({ getBackend: () => "memory", titleModel: injected })
    const args = memoryCtorSpy.mock.calls.at(-1)?.[0] as {
      options: { generateTitle: { model: unknown } }
    }
    expect(args.options.generateTitle.model).toBe(injected)
  })

  it("pinned dist fact (KTD1): the installed Agent.getLLM path accepts a function returning a model array", async () => {
    // Guards the KTD1 cast across @mastra/* bumps. The declared type of
    // `generateTitle.model` is the singular DynamicArgument<MastraModelConfig>,
    // but the title path hands it to Agent.getLLM → resolveModelSelection,
    // which accepts a function returning a ModelWithRetries[] and normalizes
    // it (verified 2026-08-27 against the installed @mastra/core). If a bump
    // makes this throw or resolve nothing, the function-valued default is no
    // longer safe and this test goes red before production does.
    const chain: ModelWithRetries[] = [
      { model: "openrouter/google/gemma-4-31b-it:free", maxRetries: 1 },
      { model: "openrouter/google/gemma-4-26b-a4b-it:free", maxRetries: 1 },
    ]
    const probe = new Agent({
      id: "title-model-shape-probe",
      name: "title-model-shape-probe",
      instructions: "probe",
      model: "openrouter/google/gemma-4-31b-it:free",
    })
    const llm = await probe.getLLM({
      model: (() => chain) as unknown as MastraModelConfig,
    })
    expect(llm).toBeTruthy()
    // The normalized selection resolves the FIRST entry as the active model —
    // the same first-enabled pick genTitle's stream call will use.
    const model = llm.getModel() as { modelId?: string }
    expect(model.modelId).toBe("google/gemma-4-31b-it:free")
  })

  it("honors the injectable backend seam on the singleton path", () => {
    // The default singleton resolves through the mocked env (memory here) —
    // proving getBackend defaults to resolveAiChatMemoryBackend.
    mockEnv.aiChatBackend = "postgres"
    __resetAiChatMemoryForTesting()
    getAiChatMemory()
    expect(postgresStoreSpy).toHaveBeenCalledTimes(1)
  })

  it("does not open a connection at construction time on the postgres path", () => {
    mockEnv.env.DATABASE_URL =
      "postgresql://nobody:nopass@nonexistent-host-7vqf:5432/no_db"
    expect(() =>
      buildAiChatMemory({ getBackend: () => "postgres" }),
    ).not.toThrow()
    mockEnv.env.DATABASE_URL = undefined
  })

  // Adversarial cross-thread isolation against a REAL InMemoryStore-backed
  // Memory. This is the assertion a no-op / identity memory layer would fail:
  // it proves messages written to thread A do not leak into thread B. Both
  // threads MUST be created first — `recall` on a never-created thread throws
  // ("No thread found with id …"), it does not return empty (verified U2 recipe).
  it("keeps messages scoped to their own thread", async () => {
    const memory = buildAiChatMemory({ getBackend: () => "memory" })
    const resourceId = "seeker-test-resource"
    const threadA = "thread-a"
    const threadB = "thread-b"
    const now = new Date()

    await memory.saveThread({
      thread: {
        id: threadA,
        resourceId,
        title: "Thread A",
        metadata: {},
        createdAt: now,
        updatedAt: now,
      },
    })
    await memory.saveThread({
      thread: {
        id: threadB,
        resourceId,
        title: "Thread B",
        metadata: {},
        createdAt: now,
        updatedAt: now,
      },
    })

    await memory.saveMessages({
      messages: [
        {
          id: "message-a-1",
          role: "user",
          threadId: threadA,
          resourceId,
          createdAt: now,
          content: {
            format: 2,
            parts: [{ type: "text", text: "Who is Jesus?" }],
            content: "Who is Jesus?",
          },
        },
      ],
    })

    const recalledA = await memory.recall({ threadId: threadA, resourceId })
    const recalledB = await memory.recall({ threadId: threadB, resourceId })

    // Exact-count + identity rather than `>= 1`: this is the tighter
    // non-vacuous assertion — it proves thread A holds exactly the message we
    // saved (not stray messages from elsewhere) and thread B holds none.
    expect(recalledA.messages).toHaveLength(1)
    expect(recalledA.messages[0]?.id).toBe("message-a-1")
    expect(recalledB.messages).toHaveLength(0)
  })
})

describe("aiChatMemoryConfigFor (feat-241 KTD12 titling scope)", () => {
  it("returns a bare { thread, resource } config for signed-in resources (titling stays enabled)", () => {
    const resource = `${USER_RESOURCE_PREFIX}oidc-sub-123`
    const config = aiChatMemoryConfigFor("thread-1", resource)
    // toEqual is the discriminator here: an `options` key on the signed-in
    // branch (disabling titling for real users) would fail this exact shape.
    expect(config).toEqual({ thread: "thread-1", resource })
    expect("options" in config).toBe(false)
  })

  it("carries the top-level generateTitle:false override for anonymous and dogfood resources", () => {
    // Fixture set mirrors production non-`user:` resources: anon:* ids and
    // the seeker-dogfood fallback (plus any unknown un-prefixed caller).
    for (const resource of ["anon:4f9d2c", "seeker-dogfood", "unknown"]) {
      const config = aiChatMemoryConfigFor("thread-2", resource)
      expect(config).toEqual({
        thread: "thread-2",
        resource,
        // TOP-LEVEL generateTitle key (KTD12) — the deprecated
        // `threads.generateTitle` nesting throws mid-turn.
        options: { generateTitle: false },
      })
    }
  })
})
