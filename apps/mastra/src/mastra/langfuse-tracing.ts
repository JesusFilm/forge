/**
 * Langfuse tracing for the seeker agent (feat-321).
 *
 * Builds the OPT-IN observability config that exports seeker traces to
 * Langfuse — the same `forge-mastra` project that holds the managed
 * `seeker-system` prompt (feat-272/feat-296), so Langfuse's prompt-version →
 * generation analytics resolve (they only link within one project).
 *
 * Content decision (feat-321, owner 2026-07-29): traces carry RAW
 * conversation content — this config deliberately omits the
 * `redactPromptBodies` span processor the default config applies. That is
 * why the config is (a) default-off behind `LANGFUSE_TRACING_ENABLED`
 * (credential presence never enables it — the key pair predates tracing,
 * provisioned for prompt reads), and (b) reached only for runs the seeker
 * route stamps with the per-process marker below; every other trace stays
 * on the redacted local-DuckDB default config. The registry-level
 * `sensitiveDataFilter` still applies to this config, so key-shaped span
 * fields (apiKey/token/authorization) are scrubbed — it never touches
 * message content.
 *
 * Selection mechanism: Mastra picks exactly ONE observability config per
 * trace. The `configSelector` compares the run RequestContext's
 * `TRACING_CONFIG_CONTEXT_KEY` entry against `LANGFUSE_SEEKER_TRACING_MARKER`
 * — an unguessable per-process random token, NOT the config name. Mastra's
 * built-in `/api/agents/*` surface is code-unauthenticated and merges a
 * caller-supplied `requestContext` from the request body, so a name-valued
 * marker would let any caller inside the network boundary opt an arbitrary
 * agent's trace into raw export; the token confines routing to code paths
 * that import this module (today: the seeker route only).
 *
 * Langfuse-ONLY export (owner decision, 2026-08-05): this config carries no
 * local storage exporter, so enabled deployments write NOTHING raw to the
 * DuckDB volume — no retention or erasure obligation ever attaches to local
 * disk, and Langfuse is the single store the feat-321 retention/erasure
 * follow-ups govern. The trade-offs accepted with that: routed seeker runs
 * do not appear in Studio's trace viewer (Langfuse is the viewer), and a
 * Langfuse outage drops those spans with no local fallback (observability
 * loss only — conversations themselves persist in Postgres). Restoring a
 * REDACTED local copy later is a deliberate follow-up: processors apply
 * per-config, not per-exporter, so it needs a small redacting wrapper
 * around the storage exporter — never a bare `MastraStorageExporter` here,
 * which would store raw content. That wrapper must ALSO strip
 * `span.requestContext` (it carries the routing marker) — see the exposure
 * note on `LANGFUSE_SEEKER_TRACING_MARKER` below.
 */

import { randomUUID } from "node:crypto"

import { RequestContext } from "@mastra/core/di"
import type { ConfigSelector } from "@mastra/core/observability"
import { SpanType } from "@mastra/core/observability"
import { LangfuseExporter } from "@mastra/langfuse"
import {
  SamplingStrategyType,
  type ObservabilityInstanceConfig,
} from "@mastra/observability"

import { env, getLangfuseConfig, isLangfuseTracingEnabled } from "../config/env"
import type { ManagedPromptResult } from "../services/langfuse-prompt-client"

/** Registry name of the raw-content seeker → Langfuse observability config. */
export const LANGFUSE_SEEKER_TRACING_CONFIG_NAME = "langfuse-seeker"

/**
 * RequestContext key the seeker route stamps to opt a run into the Langfuse
 * config. The VALUE must be `LANGFUSE_SEEKER_TRACING_MARKER`; anything else
 * (including the config's own name) is ignored by the selector.
 */
export const TRACING_CONFIG_CONTEXT_KEY = "tracingConfig"

/**
 * Per-process random opt-in token (security hardening, feat-321 review).
 * The selector honors ONLY this value, so a `requestContext` forged through
 * the unauthenticated built-in `/api/agents/*` body cannot name its way into
 * the raw config — callers can't guess a UUID minted at module load. Studio
 * playground runs don't carry it and stay on the redacted default config.
 *
 * **Exposure, corrected 2026-08-06 (security review).** The marker DOES
 * appear in exported span records: `@mastra/observability` copies the run's
 * full RequestContext onto every span and carries it in the span's export
 * shape (verified at 1.16.3), and the built-in `/api/observability/traces*`
 * read routes serve stored spans back — effectively unauthenticated here, as
 * `index.ts` configures no server auth provider. `redactPromptBodies`-style
 * processors blank `input`/`output` ONLY; they never strip `requestContext`.
 *
 * What keeps that safe is that the LIVE marker is never persisted anywhere
 * readable, not that it stays in-process:
 *   - tracing ENABLED  → marked seeker spans export to Langfuse ONLY, and the
 *     `@mastra/langfuse` 1.4.6 converter references `requestContext` nowhere,
 *     so the marker never reaches Langfuse either;
 *   - tracing DISABLED → marked spans DO land in the local store and are
 *     readable on those routes, but the marker then selects nothing (the raw
 *     config is not registered), and enabling tracing requires a redeploy,
 *     which mints a fresh marker.
 * Leak window and exploit window are mutually exclusive.
 *
 * **Binding constraint on the follow-up in the module header above:** any
 * future local storage exporter added to THIS config must strip
 * `span.requestContext` before writing — the redacting wrapper described
 * there has to cover the marker as well as the content, or the live marker
 * becomes readable on those code-unauthenticated read routes.
 */
export const LANGFUSE_SEEKER_TRACING_MARKER = randomUUID()

/**
 * Config selector for `new Observability({ configSelector })`. Routes a run
 * to the Langfuse seeker config only when its RequestContext carries the
 * per-process marker AND that config is registered (tracing enabled +
 * credentials present); every other run falls through to the default
 * instance. Fail-closed on both axes: a stamped run degrades to the default
 * (redacted, local-only) config whenever tracing is disabled, and an
 * unstamped or forged-value run never reaches the raw config.
 */
export const selectObservabilityConfig: ConfigSelector = (
  options,
  availableConfigs,
) => {
  const requested = options.requestContext?.get(TRACING_CONFIG_CONTEXT_KEY)
  if (
    requested === LANGFUSE_SEEKER_TRACING_MARKER &&
    availableConfigs.has(LANGFUSE_SEEKER_TRACING_CONFIG_NAME)
  ) {
    return LANGFUSE_SEEKER_TRACING_CONFIG_NAME
  }
  return undefined
}

/** One entry of the `Observability` configs record (registry value shape). */
export type ObservabilityConfigEntry = Omit<ObservabilityInstanceConfig, "name">

type BuildDeps = {
  /** Seam for tests. Defaults to the env-backed flag (default-off). */
  getEnabled?: () => boolean
  /** Seam for tests. Defaults to the env-backed Langfuse credential group. */
  getConfig?: () => {
    baseUrl?: string
    publicKey?: string
    secretKey?: string
  }
  /** Seam for tests. Defaults to `env.NODE_ENV`. */
  getNodeEnv?: () => string | undefined
}

/**
 * Builds the Langfuse seeker observability config, or `undefined` when
 * tracing is off or the credential trio is incomplete (partial credentials
 * log one plain-string line and stay off — never a boot failure, mirroring
 * the prompt helper's optional posture).
 */
export function buildLangfuseSeekerObservabilityConfig(
  deps: BuildDeps = {},
): ObservabilityConfigEntry | undefined {
  const {
    getEnabled = isLangfuseTracingEnabled,
    getConfig = getLangfuseConfig,
    getNodeEnv = () => env.NODE_ENV,
  } = deps

  if (!getEnabled()) return undefined

  const { baseUrl, publicKey, secretKey } = getConfig()
  if (!baseUrl || !publicKey || !secretKey) {
    console.warn(
      "[langfuse-tracing] event=tracing_disabled reason=config_missing",
    )
    return undefined
  }

  // Media upload OFF by default (feat-321 decision, 2026-08-05): the
  // Langfuse SDK's auto media upload defaults ON, is read from this env var
  // at span-processor construction inside @langfuse/otel (verified at 5.10.0:
  // only the exact strings `"false"`/`"0"` disable; a BLANK value reads as
  // absent → ON), and @mastra/langfuse 1.4.6 forwards no code-level option —
  // so seeding the env default here, BEFORE the exporter is constructed
  // below in this same synchronous body, is the only in-code lever. The
  // falsy guard (not `??=`) treats an empty string as unset, mirroring the
  // `emptyToUndefined` semantics every schema-declared env var gets; any
  // non-empty operator value (e.g. an explicit "true") wins untouched.
  if (!process.env.LANGFUSE_MEDIA_UPLOAD_ENABLED) {
    process.env.LANGFUSE_MEDIA_UPLOAD_ENABLED = "false"
  }

  const production = getNodeEnv() === "production"
  return {
    serviceName: "forge-mastra",
    sampling: { type: SamplingStrategyType.ALWAYS },
    logging: { enabled: true, level: "info" },
    // Streaming turns emit one MODEL_CHUNK span per token batch — pure noise
    // in the trace tree, and Langfuse bills per span.
    excludeSpanTypes: [SpanType.MODEL_CHUNK],
    // Langfuse is the ONLY destination — deliberately no local storage
    // exporter (see the module header: Langfuse-only owner decision,
    // 2026-08-05). A `MastraStorageExporter` added here would store RAW
    // conversation content on the DuckDB volume with no retention tooling.
    exporters: [
      new LangfuseExporter({
        publicKey,
        secretKey,
        baseUrl,
        // Batch mode in production (throughput); realtime locally so a dev
        // sees the trace immediately after the turn.
        realtime: !production,
        environment: production ? "production" : "development",
      }),
    ],
  }
}

/**
 * Assembles the full `Observability` configs record with the ordering
 * invariant enforced structurally: the `default` entry is ALWAYS first.
 * The @mastra/observability registry treats the FIRST entry as the default
 * instance (`index === 0` in its constructor — verified at 1.13.0 and again
 * at 1.16.3), so any
 * construction that could put the raw Langfuse config first would silently
 * route every unstamped trace raw to Langfuse. Building the record here —
 * default literal first, conditional Langfuse entry appended after — plus
 * the closing assertion makes that ordering unrepresentable rather than
 * comment-guarded.
 */
export function buildObservabilityConfigs(
  defaultConfig: ObservabilityConfigEntry,
  deps: BuildDeps = {},
): Record<string, ObservabilityConfigEntry> {
  const configs: Record<string, ObservabilityConfigEntry> = {
    default: defaultConfig,
  }
  const langfuseSeeker = buildLangfuseSeekerObservabilityConfig(deps)
  if (langfuseSeeker) {
    configs[LANGFUSE_SEEKER_TRACING_CONFIG_NAME] = langfuseSeeker
  }
  // Belt-and-braces: a future edit that reorders the literal above should be
  // impossible to ship — fail loudly at module load, not silently at export.
  if (Object.keys(configs)[0] !== "default") {
    throw new Error(
      "observabilityConfigs must register 'default' first — the registry treats index 0 as the default instance",
    )
  }
  return configs
}

/**
 * Builds the per-turn `agent.stream` tracing options for a seeker send: the
 * marker-stamped RequestContext plus the root-span metadata the Langfuse
 * exporter maps to first-class trace fields (traceName → trace name,
 * userId → user, sessionId → session, and the structured `langfuse.prompt`
 * object → native prompt-version linkage; mapping verified against the real
 * forge-mastra project on 2026-07-29 with @mastra/langfuse 1.4.6 —
 * re-verify on bumps). Prompt provenance is supplied by the caller (the
 * route's `getPromptProvenance` seam) so the metadata branches are unit
 * testable here without touching the managed-prompt cache.
 */
export function buildSeekerTracingCallOptions(input: {
  promptName: string
  promptProvenance: ManagedPromptResult
  /** Memory resource (`user:<sub>` / `anon:<uuid>` / dogfood constant). */
  resource: string
  /** Memory thread id — becomes the Langfuse session id. */
  thread: string
}): {
  requestContext: RequestContext
  tracingOptions: { metadata: Record<string, unknown> }
} {
  const { promptName, promptProvenance, resource, thread } = input
  const requestContext = new RequestContext()
  requestContext.set(TRACING_CONFIG_CONTEXT_KEY, LANGFUSE_SEEKER_TRACING_MARKER)
  return {
    requestContext,
    tracingOptions: {
      metadata: {
        traceName: "seeker-turn",
        userId: resource,
        sessionId: thread,
        promptName,
        promptSource: promptProvenance.source,
        promptLabel: promptProvenance.resolvedLabel,
        ...(promptProvenance.version !== undefined
          ? { promptVersion: promptProvenance.version }
          : {}),
        ...(promptProvenance.stale === true ? { promptStale: true } : {}),
        ...(promptProvenance.source === "langfuse" &&
        promptProvenance.version !== undefined
          ? {
              langfuse: {
                prompt: { name: promptName, version: promptProvenance.version },
              },
            }
          : {}),
      },
    },
  }
}
