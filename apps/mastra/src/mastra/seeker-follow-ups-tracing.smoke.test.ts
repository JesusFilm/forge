import { randomUUID } from "node:crypto"

import { Mastra } from "@mastra/core"
import {
  MastraStorageExporter,
  Observability,
  SamplingStrategyType,
} from "@mastra/observability"
import { MockLanguageModelV3, simulateReadableStream } from "ai/test"
import { describe, expect, it } from "vitest"

import type { MastraModelConfig } from "@mastra/core/llm"

import { env, getLangfuseTraceRetentionConfig } from "../config/env"

import { LANGFUSE_ERASURE_PINNED_HOST } from "./ai-chat-erasure"
import {
  buildFollowUpsTracingCallOptions,
  buildObservabilityConfigs,
  selectObservabilityConfig,
} from "./langfuse-tracing"
import { listObservationsByUserIdPage } from "./langfuse-trace-retention"
import {
  buildFollowUpsGeneratorAgent,
  generateSeekerFollowUps,
} from "./seeker-follow-ups-generate"

/**
 * Opt-in LIVE Langfuse trace smoke for the follow-ups generator (feat-366
 * U1, KTD9). Walks the KTD9 ladder against the real `forge-mastra` project:
 *
 *   1. SPAN EXISTENCE (ship-blocker): the generator call, made through an
 *      Agent holding a real Mastra reference whose observability registers
 *      the `langfuse-seeker` config, produces observations that a
 *      `userId`-filtered listing RETURNS — the exact primitive the feat-337
 *      erasure CLI uses, so a failure here means these spans would be
 *      invisible to erasure (a ship-blocker, not an observability nit).
 *   2. TRACE SHAPE (recorded either way): whether the second generator call
 *      — handed the first call's trace/span ids the way the route hands the
 *      turn's — landed in the SAME trace (`trace_shape=same-trace`) or a
 *      SIBLING trace with the same stamps (`trace_shape=sibling`). Both are
 *      acceptable (KTD9); the console line is the recorded outcome.
 *
 * The MODEL is mocked (zero provider spend; spans come from the agent
 * framework, not the provider) and the generator agent is built through the
 * module's own factory + the real `__registerMastra` hook — the wiring under
 * test is registration → marker routing → Langfuse export → session/user
 * stamps → by-userId listing.
 *
 * The egress pin runs IN-SUITE, BEFORE any credential is computed: the
 * boot-time `LANGFUSE_ALLOWED_HOSTS` assertion is production-only and inert
 * under vitest (NODE_ENV=test — also why a NODE_ENV refusal alone could
 * never fire here), mirroring `ai-chat-erasure.langfuse.smoke.test.ts`.
 *
 * Writes TRACES only (no deletes — zero delete-quota spend). Each run leaves
 * a handful of observations under a throwaway `user:followups-trace-smoke-*`
 * subject; the feat-336 retention sweep drains them within 25 days.
 *
 * TO RUN (local-dev Langfuse pair only, never Railway's; subshell so the
 * credentials die with it):
 *
 *   (set -a; source <(grep '^LANGFUSE_' apps/mastra/.env); set +a; \
 *    SEEKER_FOLLOWUPS_TRACE_SMOKE_TEST=1 \
 *    pnpm --filter @forge/mastra test -- seeker-follow-ups-tracing.smoke)
 */

const RUN_SMOKE = env.SEEKER_FOLLOWUPS_TRACE_SMOKE_TEST === "1"

const SMOKE_TEST_TIMEOUT_MS = 180_000
/** Export is realtime under the dev-shaped config, but the read surface
 * indexes asynchronously — poll the listing with patience. */
const LISTING_POLL_ATTEMPTS = 12
const LISTING_POLL_DELAY_MS = 5_000

const MOCK_USAGE = {
  inputTokens: { total: 11, noCache: 11, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 7, text: 7, reasoning: 0 },
}

type DoStreamReturn = Awaited<ReturnType<MockLanguageModelV3["doStream"]>>
type StreamPart = DoStreamReturn extends { stream: ReadableStream<infer P> }
  ? P
  : never
type DoGenerateReturn = Awaited<ReturnType<MockLanguageModelV3["doGenerate"]>>

function mockModel(replyText: string): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: replyText }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: MOCK_USAGE as DoGenerateReturn["usage"],
      warnings: [],
    }),
    doStream: async () => ({
      stream: simulateReadableStream<StreamPart>({
        initialDelayInMs: null,
        chunkDelayInMs: null,
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "0" },
          { type: "text-delta", id: "0", delta: replyText },
          { type: "text-end", id: "0" },
          {
            type: "finish",
            finishReason: { unified: "stop" as const, raw: "stop" },
            usage: MOCK_USAGE,
          },
        ] as StreamPart[],
      }),
    }),
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe.skipIf(!RUN_SMOKE)("seeker follow-ups live trace smoke (KTD9)", () => {
  const config = getLangfuseTraceRetentionConfig()
  if (RUN_SMOKE && !(config.baseUrl && config.publicKey && config.secretKey)) {
    // Loud, not skipped: the gate was set deliberately.
    throw new Error(
      "SEEKER_FOLLOWUPS_TRACE_SMOKE_TEST=1 requires the LANGFUSE_BASE_URL/" +
        "LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY trio in the process env",
    )
  }
  if (RUN_SMOKE) {
    // KTD9/KTD11 egress pin, BEFORE any auth value is computed: this suite
    // exports spans with real Basic credentials, so the base URL must be
    // https AND its host either the pinned vendor-cloud host or listed in
    // LANGFUSE_ALLOWED_HOSTS.
    const url = new URL(config.baseUrl ?? "")
    const allowedHosts = new Set(
      (env.LANGFUSE_ALLOWED_HOSTS ?? "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    )
    const host = url.hostname.toLowerCase()
    if (
      url.protocol !== "https:" ||
      !(host === LANGFUSE_ERASURE_PINNED_HOST || allowedHosts.has(host))
    ) {
      throw new Error(
        "seeker-follow-ups-tracing.smoke: LANGFUSE_BASE_URL must be https " +
          "with the pinned host or one listed in LANGFUSE_ALLOWED_HOSTS " +
          "(egress pin) — refusing to send credentials",
      )
    }
  }

  it(
    "generator spans exist, carry the session/user stamps, and the userId-filtered listing returns them (ship-blocker); trace shape recorded",
    async () => {
      const runId = randomUUID().slice(0, 8)
      const subject = `user:followups-trace-smoke-${runId}`
      const session = `followups-trace-smoke-thread-${runId}`

      // A REAL observability-enabled Mastra instance: the langfuse-seeker
      // config registered through the production builder (enabled + real
      // trio; dev-shaped so the exporter runs realtime). The default config
      // needs SOME exporter to construct (registry invariant); the storage
      // exporter over this store-less probe instance is inert, and every
      // call below carries the marker, so nothing routes to it anyway.
      const observability = new Observability({
        sensitiveDataFilter: true,
        configSelector: selectObservabilityConfig,
        configs: buildObservabilityConfigs(
          {
            serviceName: "followups-trace-smoke",
            sampling: { type: SamplingStrategyType.ALWAYS },
            exporters: [new MastraStorageExporter()],
          },
          {
            getEnabled: () => true,
            getConfig: () => ({
              baseUrl: config.baseUrl,
              publicKey: config.publicKey,
              secretKey: config.secretKey,
            }),
            getNodeEnv: () => "development",
          },
        ),
      })
      const mastra = new Mastra({
        agents: {} as never,
        observability,
      })

      const agent = buildFollowUpsGeneratorAgent({
        models: [
          {
            model: mockModel(
              '["Why does prayer matter?", "Who wrote the gospels?"]',
            ) as unknown as MastraModelConfig,
            maxRetries: 0,
          },
        ],
      })
      agent.__registerMastra(mastra as never)

      const answer =
        "A grounded smoke answer about who Jesus is. ".repeat(8) +
        "It closes with a line the prompt forbids duplicating."

      // Call 1 — the "turn" stand-in: yields the trace/span ids the route
      // would read off the seeker stream's output.
      const turnTracing = buildFollowUpsTracingCallOptions({
        resource: subject,
        thread: session,
      })
      const first = await generateSeekerFollowUps({
        question: "who is jesus?",
        answer,
        agent,
        budgetMs: 10_000,
        requestContext: turnTracing.requestContext,
        tracingOptions: turnTracing.tracingOptions,
      })
      expect(first.questions.length).toBeGreaterThan(0)
      expect(
        first.traceId,
        "call 1 produced no traceId — no spans",
      ).toBeTruthy()

      // Call 2 — the generator proper, handed call 1's ids the way the route
      // hands the turn's (the same-trace attempt).
      const joinedTracing = buildFollowUpsTracingCallOptions({
        resource: subject,
        thread: session,
        turnTraceId: first.traceId,
        turnSpanId: first.spanId,
      })
      const second = await generateSeekerFollowUps({
        question: "who is jesus?",
        answer,
        agent,
        budgetMs: 10_000,
        requestContext: joinedTracing.requestContext,
        tracingOptions: joinedTracing.tracingOptions,
      })
      expect(second.questions.length).toBeGreaterThan(0)
      expect(
        second.traceId,
        "call 2 produced no traceId — no spans",
      ).toBeTruthy()

      // Flush + poll the by-userId listing (the erasure primitive) until the
      // spans are indexed. SHIP-BLOCKER: a negative listing means erasure
      // could never find these spans.
      await (
        observability as unknown as { shutdown?: () => Promise<void> }
      ).shutdown?.()
      let rows: Array<{ traceId: string; userId: string }> = []
      for (let attempt = 0; attempt < LISTING_POLL_ATTEMPTS; attempt += 1) {
        await delay(LISTING_POLL_DELAY_MS)
        const page = await listObservationsByUserIdPage({
          config,
          userId: subject,
        })
        if (page.ok && page.rows.length > 0) {
          rows = page.rows
          break
        }
      }
      expect(
        rows.length,
        "userId-filtered listing returned no generator observations (erasure could not find them) — SHIP-BLOCKER",
      ).toBeGreaterThan(0)
      expect(rows.every((row) => row.userId === subject)).toBe(true)

      // Trace shape, recorded either way (KTD9: same-trace or sibling both
      // acceptable). Same-trace iff call 2's spans landed under call 1's id.
      const traceIds = new Set(rows.map((row) => row.traceId))
      const sameTrace =
        second.traceId === first.traceId && traceIds.has(first.traceId!)
      console.info(
        `[followups-trace-smoke] event=ladder_walked spans_listed=${rows.length} distinct_traces=${traceIds.size} trace_shape=${sameTrace ? "same-trace" : "sibling"} listing_returned_subject_rows=true`,
      )
    },
    SMOKE_TEST_TIMEOUT_MS,
  )
})
