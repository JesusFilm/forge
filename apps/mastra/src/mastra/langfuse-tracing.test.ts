import { RequestContext } from "@mastra/core/di"
import { SpanType } from "@mastra/core/observability"
import { LangfuseExporter } from "@mastra/langfuse"
import { MastraStorageExporter, Observability } from "@mastra/observability"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ManagedPromptResult } from "../services/langfuse-prompt-client"
import {
  buildFollowUpsTracingCallOptions,
  buildLangfuseSeekerObservabilityConfig,
  buildObservabilityConfigs,
  buildSeekerTracingCallOptions,
  LANGFUSE_SEEKER_TRACING_CONFIG_NAME,
  LANGFUSE_SEEKER_TRACING_MARKER,
  selectObservabilityConfig,
  TRACING_CONFIG_CONTEXT_KEY,
} from "./langfuse-tracing"

const CONFIGURED = {
  baseUrl: "https://cloud.langfuse.com",
  publicKey: "pk-lf-test",
  secretKey: "sk-lf-test",
}

const ENABLED_DEPS = {
  getEnabled: () => true,
  getConfig: () => CONFIGURED,
  getNodeEnv: () => "development",
}

function fallbackProvenance(
  overrides: Partial<ManagedPromptResult> = {},
): ManagedPromptResult {
  return {
    text: "prompt text",
    source: "fallback",
    resolvedLabel: "production",
    ...overrides,
  }
}

// The selector only cares about map KEYS; instances are opaque to it.
function registryWith(
  ...names: string[]
): Parameters<typeof selectObservabilityConfig>[1] {
  return new Map(names.map((n) => [n, {}])) as unknown as Parameters<
    typeof selectObservabilityConfig
  >[1]
}

function markedContext(value: unknown): RequestContext {
  const requestContext = new RequestContext()
  requestContext.set(TRACING_CONFIG_CONTEXT_KEY, value)
  return requestContext
}

// Restored after EVERY test (not only the media block): the enabled-path
// builder seeds this var as a side effect, and vi.unstubAllEnvs does NOT
// revert raw process.env assignments — without this the seed leaks for the
// worker's lifetime and bleeds across tests.
const MEDIA_ENV_ORIGINAL = process.env.LANGFUSE_MEDIA_UPLOAD_ENABLED

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  if (MEDIA_ENV_ORIGINAL === undefined) {
    delete process.env.LANGFUSE_MEDIA_UPLOAD_ENABLED
  } else {
    process.env.LANGFUSE_MEDIA_UPLOAD_ENABLED = MEDIA_ENV_ORIGINAL
  }
})

describe("selectObservabilityConfig", () => {
  it("returns undefined when the run carries no RequestContext", () => {
    expect(
      selectObservabilityConfig(
        {},
        registryWith("default", LANGFUSE_SEEKER_TRACING_CONFIG_NAME),
      ),
    ).toBeUndefined()
  })

  it("selects the Langfuse config when the per-process marker is stamped and the config is registered", () => {
    expect(
      selectObservabilityConfig(
        { requestContext: markedContext(LANGFUSE_SEEKER_TRACING_MARKER) },
        registryWith("default", LANGFUSE_SEEKER_TRACING_CONFIG_NAME),
      ),
    ).toBe(LANGFUSE_SEEKER_TRACING_CONFIG_NAME)
  })

  it("degrades to undefined when the marker is stamped but tracing is disabled (config unregistered)", () => {
    // The seeker route stamps unconditionally; when the Langfuse config was
    // not built (flag off / creds missing) the stamp must fall through to the
    // default instance rather than selecting a ghost config.
    expect(
      selectObservabilityConfig(
        { requestContext: markedContext(LANGFUSE_SEEKER_TRACING_MARKER) },
        registryWith("default"),
      ),
    ).toBeUndefined()
  })

  it("rejects a forged marker carrying the config NAME (unauthenticated body forgery pin)", () => {
    // Security invariant (feat-321 review): Mastra's built-in /api/agents/*
    // surface merges caller-supplied requestContext from the request body, so
    // the guessable config name must NOT select the raw config — only the
    // unguessable per-process token may.
    expect(
      selectObservabilityConfig(
        { requestContext: markedContext(LANGFUSE_SEEKER_TRACING_CONFIG_NAME) },
        registryWith("default", LANGFUSE_SEEKER_TRACING_CONFIG_NAME),
      ),
    ).toBeUndefined()
  })

  it("ignores arbitrary and non-string marker values", () => {
    const registry = registryWith(
      "default",
      LANGFUSE_SEEKER_TRACING_CONFIG_NAME,
    )
    expect(
      selectObservabilityConfig(
        { requestContext: markedContext("default") },
        registry,
      ),
    ).toBeUndefined()
    expect(
      selectObservabilityConfig(
        { requestContext: markedContext(42) },
        registry,
      ),
    ).toBeUndefined()
  })
})

describe("buildLangfuseSeekerObservabilityConfig", () => {
  it("returns undefined when the flag is off, without logging", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(
      buildLangfuseSeekerObservabilityConfig({
        getEnabled: () => false,
        getConfig: () => CONFIGURED,
      }),
    ).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })

  it("returns undefined by default (env flag unset — the default-off pin)", () => {
    // No-deps call reads the real env-backed defaults; the test env never
    // sets LANGFUSE_TRACING_ENABLED, so this pins that a bare deploy stays
    // off even with credentials present.
    expect(buildLangfuseSeekerObservabilityConfig()).toBeUndefined()
  })

  it.each([
    ["baseUrl", { ...CONFIGURED, baseUrl: undefined }],
    ["publicKey", { ...CONFIGURED, publicKey: undefined }],
    ["secretKey", { ...CONFIGURED, secretKey: undefined }],
  ])(
    "returns undefined and logs config_missing when %s is absent",
    (_label, config) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      expect(
        buildLangfuseSeekerObservabilityConfig({
          getEnabled: () => true,
          getConfig: () => config,
        }),
      ).toBeUndefined()
      expect(warn).toHaveBeenCalledWith(
        "[langfuse-tracing] event=tracing_disabled reason=config_missing",
      )
    },
  )

  it("builds the raw-content config when enabled and fully configured", () => {
    const built = buildLangfuseSeekerObservabilityConfig(ENABLED_DEPS)
    expect(built).toBeDefined()
    expect(built?.serviceName).toBe("forge-mastra")
    // Raw by decision (feat-321): NO redactPromptBodies-style processor key.
    expect(built).not.toHaveProperty("spanOutputProcessors")
    expect(built?.excludeSpanTypes).toEqual([SpanType.MODEL_CHUNK])
    expect(built?.exporters).toHaveLength(1)
    expect(built?.exporters?.[0]).toBeInstanceOf(LangfuseExporter)
  })

  it.each([["development"], ["production"]])(
    "exports to Langfuse ONLY — no local storage exporter (%s)",
    (nodeEnv) => {
      // Langfuse-only owner decision (2026-08-05): a MastraStorageExporter in
      // this config would write RAW conversation content to the DuckDB volume
      // with no retention or erasure tooling. Both env branches are pinned so
      // neither can quietly regain a local copy.
      const built = buildLangfuseSeekerObservabilityConfig({
        ...ENABLED_DEPS,
        getNodeEnv: () => nodeEnv,
      })
      expect(built?.exporters).toHaveLength(1)
      expect(
        built?.exporters?.some((e) => e instanceof MastraStorageExporter),
      ).toBe(false)
      expect(built?.exporters?.[0]).toBeInstanceOf(LangfuseExporter)
    },
  )

  describe("LANGFUSE_MEDIA_UPLOAD_ENABLED seed (fail-closed media default)", () => {
    // The Langfuse SDK's auto media upload defaults ON and reads only this
    // env var (@langfuse/otel, verified at 5.10.0: only exact "false"/"0"
    // disable; a BLANK value reads as absent → ON); @mastra/langfuse
    // forwards no code option. The file-level afterEach restores the var,
    // so tests here manage only their starting state.
    beforeEach(() => {
      delete process.env.LANGFUSE_MEDIA_UPLOAD_ENABLED
    })

    it.each([
      ["unset", undefined, "false"],
      [
        "empty string (a blank Railway value reads as absent to the SDK)",
        "",
        "false",
      ],
      ['operator "false"', "false", "false"],
      ['operator "0"', "0", "0"],
      ['operator "true" (explicit re-enable wins)', "true", "true"],
    ])(
      "seeds only when the operator provided nothing: %s",
      (_label, initial, expected) => {
        if (initial !== undefined) {
          process.env.LANGFUSE_MEDIA_UPLOAD_ENABLED = initial
        }
        buildLangfuseSeekerObservabilityConfig(ENABLED_DEPS)
        expect(process.env.LANGFUSE_MEDIA_UPLOAD_ENABLED).toBe(expected)
      },
    )

    it("stays untouched when tracing is disabled (flag off)", () => {
      // The seed belongs to the enabled path only — a disabled deployment
      // must not grow surprise env state.
      buildLangfuseSeekerObservabilityConfig({
        getEnabled: () => false,
        getConfig: () => CONFIGURED,
      })
      expect(process.env.LANGFUSE_MEDIA_UPLOAD_ENABLED).toBeUndefined()
    })

    it("stays untouched on the config_missing return (credential guard runs before the seed)", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      buildLangfuseSeekerObservabilityConfig({
        getEnabled: () => true,
        getConfig: () => ({ ...CONFIGURED, secretKey: undefined }),
      })
      expect(warn).toHaveBeenCalled()
      expect(process.env.LANGFUSE_MEDIA_UPLOAD_ENABLED).toBeUndefined()
    })
  })

  it("reads the real env-backed defaults when called with no deps (default-source pin)", async () => {
    // Pins BOTH seam defaults (getEnabled AND getConfig) against the real
    // env module: with the flag and the credential trio stubbed into
    // process.env before a fresh module load, the zero-deps call must build
    // a config — proving the defaults are the env-backed sources, so a
    // one-line revert of either default cannot stay green.
    vi.stubEnv("LANGFUSE_TRACING_ENABLED", "true")
    vi.stubEnv("LANGFUSE_BASE_URL", "https://us.cloud.langfuse.com")
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-lf-pin")
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-lf-pin")
    vi.resetModules()
    try {
      const fresh = await import("./langfuse-tracing")
      const built = fresh.buildLangfuseSeekerObservabilityConfig()
      expect(built).toBeDefined()
      expect(built?.exporters?.[0]).toBeInstanceOf(LangfuseExporter)
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })
})

describe("buildObservabilityConfigs", () => {
  // The registry validates each entry at construction (at least one exporter
  // or bridge required), so mirror the production default's exporter shape.
  const DEFAULT_ENTRY = {
    serviceName: "forge-mastra",
    exporters: [new MastraStorageExporter()],
  }

  it("registers ONLY the default config when tracing is disabled", () => {
    const configs = buildObservabilityConfigs(DEFAULT_ENTRY, {
      getEnabled: () => false,
    })
    expect(Object.keys(configs)).toEqual(["default"])
    expect(configs.default).toBe(DEFAULT_ENTRY)
  })

  it("registers default FIRST and the Langfuse config second when enabled (ordering invariant)", () => {
    // The @mastra/observability registry treats the FIRST entry as the
    // default instance (index === 0, verified at 1.13.0). If this ordering
    // ever flips, every unstamped trace would flow raw to Langfuse.
    const configs = buildObservabilityConfigs(DEFAULT_ENTRY, ENABLED_DEPS)
    expect(Object.keys(configs)).toEqual([
      "default",
      LANGFUSE_SEEKER_TRACING_CONFIG_NAME,
    ])
  })

  it("routes marker-stamped runs (and only those) to the Langfuse instance in a REAL registry", () => {
    // Integration pin over the actual @mastra/observability registry: the
    // wiring index.ts performs (configSelector + configs) selects the
    // default instance for unstamped runs and the Langfuse instance only for
    // the per-process marker.
    const observability = new Observability({
      sensitiveDataFilter: true,
      configSelector: selectObservabilityConfig,
      configs: buildObservabilityConfigs(DEFAULT_ENTRY, ENABLED_DEPS),
    })
    expect(observability.getSelectedInstance({})?.getConfig().name).toBe(
      "default",
    )
    expect(
      observability
        .getSelectedInstance({
          requestContext: markedContext(LANGFUSE_SEEKER_TRACING_MARKER),
        })
        ?.getConfig().name,
    ).toBe(LANGFUSE_SEEKER_TRACING_CONFIG_NAME)
    expect(
      observability
        .getSelectedInstance({
          requestContext: markedContext(LANGFUSE_SEEKER_TRACING_CONFIG_NAME),
        })
        ?.getConfig().name,
    ).toBe("default")
  })
})

describe("buildSeekerTracingCallOptions", () => {
  it("stamps the per-process marker on a fresh RequestContext", () => {
    const { requestContext } = buildSeekerTracingCallOptions({
      promptName: "seeker-system",
      promptProvenance: fallbackProvenance(),
      resource: "user:abc",
      thread: "thread-1",
    })
    expect(requestContext.get(TRACING_CONFIG_CONTEXT_KEY)).toBe(
      LANGFUSE_SEEKER_TRACING_MARKER,
    )
  })

  it("emits full metadata incl. native prompt linkage for a versioned langfuse serve", () => {
    const { tracingOptions } = buildSeekerTracingCallOptions({
      promptName: "seeker-system",
      promptProvenance: fallbackProvenance({ source: "langfuse", version: 3 }),
      resource: "user:abc",
      thread: "thread-1",
    })
    expect(tracingOptions.metadata).toEqual({
      traceName: "seeker-turn",
      userId: "user:abc",
      sessionId: "thread-1",
      promptName: "seeker-system",
      promptSource: "langfuse",
      promptLabel: "production",
      promptVersion: 3,
      langfuse: { prompt: { name: "seeker-system", version: 3 } },
    })
  })

  it("omits version fields and the langfuse linkage on a fallback serve", () => {
    const { tracingOptions } = buildSeekerTracingCallOptions({
      promptName: "seeker-system",
      promptProvenance: fallbackProvenance({ reason: "config_missing" }),
      resource: "anon:xyz",
      thread: "thread-2",
    })
    expect(tracingOptions.metadata).not.toHaveProperty("promptVersion")
    expect(tracingOptions.metadata).not.toHaveProperty("langfuse")
    expect(tracingOptions.metadata.promptSource).toBe("fallback")
  })

  it("marks stale serves and never links a version-less langfuse serve", () => {
    const { tracingOptions } = buildSeekerTracingCallOptions({
      promptName: "seeker-system",
      promptProvenance: fallbackProvenance({
        source: "langfuse",
        stale: true,
      }),
      resource: "user:abc",
      thread: "thread-3",
    })
    expect(tracingOptions.metadata.promptStale).toBe(true)
    expect(tracingOptions.metadata).not.toHaveProperty("promptVersion")
    expect(tracingOptions.metadata).not.toHaveProperty("langfuse")
  })

  it("stamps the click-source under sendOrigin when supplied (KTD11)", () => {
    for (const sendOrigin of ["follow_up", "typed"] as const) {
      const { tracingOptions } = buildSeekerTracingCallOptions({
        promptName: "seeker-system",
        promptProvenance: fallbackProvenance(),
        resource: "user:abc",
        thread: "thread-1",
        sendOrigin,
      })
      expect(tracingOptions.metadata.sendOrigin).toBe(sendOrigin)
    }
  })

  it("keeps sendOrigin and the provenance promptSource as DISTINCT metadata keys (KTD11 key pin)", () => {
    // `promptSource` already means prompt provenance (langfuse | fallback);
    // the click-source stamp must never re-merge into it — one key answering
    // two questions is how the next reader silently loses one of them.
    const { tracingOptions } = buildSeekerTracingCallOptions({
      promptName: "seeker-system",
      promptProvenance: fallbackProvenance({ source: "langfuse", version: 3 }),
      resource: "user:abc",
      thread: "thread-1",
      sendOrigin: "follow_up",
    })
    expect(tracingOptions.metadata.sendOrigin).toBe("follow_up")
    expect(tracingOptions.metadata.promptSource).toBe("langfuse")
  })
})

describe("buildFollowUpsTracingCallOptions (KTD9)", () => {
  it("stamps the per-process marker so generator spans route to langfuse-seeker", () => {
    const { requestContext } = buildFollowUpsTracingCallOptions({
      resource: "user:abc",
      thread: "thread-1",
    })
    expect(requestContext.get(TRACING_CONFIG_CONTEXT_KEY)).toBe(
      LANGFUSE_SEEKER_TRACING_MARKER,
    )
  })

  it("carries the sibling-trace name plus the same session/user stamps", () => {
    // The stamps are what keep the feat-336 retention sweep and feat-337
    // erasure able to FIND these spans (userId-filtered listing).
    const { tracingOptions } = buildFollowUpsTracingCallOptions({
      resource: "user:abc",
      thread: "thread-1",
    })
    expect(tracingOptions.metadata).toEqual({
      traceName: "seeker-follow-ups",
      userId: "user:abc",
      sessionId: "thread-1",
    })
    expect(tracingOptions).not.toHaveProperty("traceId")
    expect(tracingOptions).not.toHaveProperty("parentSpanId")
  })

  it("attempts same-trace joining when the turn's trace/span ids are known", () => {
    const { tracingOptions } = buildFollowUpsTracingCallOptions({
      resource: "user:abc",
      thread: "thread-1",
      turnTraceId: "abc123",
      turnSpanId: "def456",
    })
    expect(tracingOptions.traceId).toBe("abc123")
    expect(tracingOptions.parentSpanId).toBe("def456")
  })
})
