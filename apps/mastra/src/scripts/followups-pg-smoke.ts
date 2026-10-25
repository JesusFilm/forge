/**
 * Real-Postgres persist/replay smoke for seeker follow-up questions
 * (feat-366 U1). Proves against a live `ai_chat` store what mocked-store
 * tests structurally cannot:
 *
 * Numbered to MATCH the step comments in the body, one-to-one:
 *
 *   1. a REAL agent turn (mocked model — no provider spend) writes the
 *      stored rows the carrier scan must find;
 *   2. the stored `createdAt` of that row falls inside the app-clock window
 *      [turnStartedAtMs, turnEndedAtMs] the carrier scan gates on — a
 *      clock-SKEW check on the window, NOT a proof of which clock stamps the
 *      row (that is settled by dist read; see the step-2 comment in the body);
 *   3. `persistSeekerFollowUps` deep-merges `content.metadata.seekerFollowUps`
 *      into the stored assistant row while `parts` AND sibling metadata keys
 *      survive (the @mastra/memory 1.24.0 dist fact this feature leans on —
 *      re-verify on `@mastra/*` bumps), and the replay route re-derives the
 *      questions onto its wire;
 *   4. a second persist OVERWRITES the key (never merges the two sets);
 *   5. the next turn on a metadata-carrying thread still streams normally; and
 *   6. a persist for turn TWO targets turn two's message, leaving turn one's
 *      stored set intact — the multi-turn carrier shape a single-turn store
 *      cannot discriminate.
 *
 * Run (against a THROWAWAY Postgres 16 — never production):
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/followups_smoke \
 *   pnpm --filter @forge/mastra smoke:followups-pg
 *
 * `PostgresStore` runs its own DDL at init, so an empty database is enough.
 *
 * PREFLIGHT (a control, not prose): refuses a production RUNTIME
 * (`NODE_ENV=production` — the Railway console sets it), refuses a
 * Railway-shaped HOSTNAME outright (railway/rlwy — deny BEFORE allow; the
 * default Railway database is literally named `railway`), and then accepts
 * only a connection string whose PARSED database name is exactly
 * `followups_smoke` — UNCONDITIONALLY, with no loopback bypass (adversarial
 * review: a `railway proxy`/SSH tunnel presents production as 127.0.0.1, so
 * loopback is evidence of locality, never of throwaway-ness; requiring the
 * name costs one `createdb followups_smoke`). Never a whole-URL substring
 * match, which a hostname or password could satisfy while pointing at
 * production. A tunnel to a production database named `followups_smoke`
 * would still pass — the name requirement is a guard against the realistic
 * accident, not a proof.
 */

import { randomUUID } from "node:crypto"

import { MockLanguageModelV3, simulateReadableStream } from "ai/test"

import type { Memory } from "@mastra/memory"

import { buildAiChatMemory } from "../mastra/ai-chat-memory"
import { buildSeekerAgent } from "../mastra/agents/seeker-agent"
import { handleAiChatHistoryReplayRequest } from "../mastra/ai-chat-history-route"
import { SEEKER_FOLLOW_UPS_METADATA_KEY } from "../mastra/seeker-follow-ups"
import {
  persistSeekerFollowUps,
  type FollowUpsPersistMemory,
} from "../mastra/seeker-follow-ups-persist"

const SMOKE_DATABASE_NAME = "followups_smoke"

function fail(message: string): never {
  console.error(`[followups-pg-smoke] event=failed reason=${message}`)
  process.exit(1)
}

function assertThrowawayTarget(databaseUrl: string): void {
  if (process.env.NODE_ENV === "production") {
    fail("production_runtime_refused")
  }
  let url: URL
  try {
    url = new URL(databaseUrl)
  } catch {
    fail("database_url_unparseable")
  }
  // Deny BEFORE the allowlist: Railway hostnames mark a real deployed
  // database regardless of what the database is named.
  if (/railway|rlwy/i.test(url.hostname)) {
    fail("railway_hostname_refused")
  }
  // UNCONDITIONAL name requirement — no loopback bypass: a forwarded local
  // port can front a production database, so the host proves nothing.
  const database = url.pathname.replace(/^\/+/, "")
  if (database !== SMOKE_DATABASE_NAME) {
    fail(`database_name_not_${SMOKE_DATABASE_NAME}`)
  }
}

const MOCK_USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

type DoStreamReturn = Awaited<ReturnType<MockLanguageModelV3["doStream"]>>
type StreamPart = DoStreamReturn extends { stream: ReadableStream<infer P> }
  ? P
  : never

function mockModel(replyText: string): MockLanguageModelV3 {
  return new MockLanguageModelV3({
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
        ],
      }),
    }),
  })
}

type SmokeAgentStream = {
  stream: (
    prompt: string,
    opts: { memory: { thread: string; resource: string } },
  ) => Promise<{
    textStream: ReadableStream<string>
    toolResults: Promise<unknown[]>
  }>
}

async function drainTurn(
  agent: SmokeAgentStream,
  prompt: string,
  thread: string,
  resource: string,
): Promise<string> {
  const output = await agent.stream(prompt, {
    memory: { thread, resource },
  })
  const reader = output.textStream.getReader()
  let full = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (typeof value === "string") full += value
  }
  await output.toolResults.catch(() => {})
  // The store write is fire-and-forget relative to the stream end; give the
  // finalization a moment so the carrier scan's single retry stays honest.
  await new Promise((resolve) => setTimeout(resolve, 300))
  return full
}

async function replayFollowUps(
  memory: Memory,
  thread: string,
  resource: string,
): Promise<{ followUps: string[] | undefined; lastText: string }> {
  const outcome = await handleAiChatHistoryReplayRequest({
    authHeader: "Bearer followups-smoke-key",
    readJson: async () => ({ resourceId: resource, threadId: thread }),
    getEnabled: () => true,
    getServiceKeys: () => ["followups-smoke-key"],
    getMemory: () => memory as never,
  })
  if (outcome.status !== 200) {
    fail(`replay_status_${outcome.status}`)
  }
  const messages = (
    outcome.body as {
      messages: Array<{ role: string; text: string; followUps?: string[] }>
    }
  ).messages
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.text.trim().length > 0)
  if (!lastAssistant) fail("no_assistant_message_replayed")
  return { followUps: lastAssistant.followUps, lastText: lastAssistant.text }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) fail("database_url_missing")
  assertThrowawayTarget(databaseUrl)

  const runId = randomUUID().slice(0, 8)
  const thread = `followups-smoke-${runId}`
  const resource = `user:followups-smoke-${runId}`
  const answer =
    "A grounded smoke answer about who Jesus is. ".repeat(8) +
    "It ends with a closing line."

  const memory = buildAiChatMemory({ getBackend: () => "postgres" })
  const persistMemory = memory as unknown as FollowUpsPersistMemory
  const agent = buildSeekerAgent({
    models: [{ model: mockModel(answer) as never, maxRetries: 0 }],
    memory,
    instructions: "You are a smoke fixture. Reply with the scripted text.",
  }) as unknown as SmokeAgentStream

  try {
    // 1. A REAL agent turn writes the rows the carrier scan must find. The
    // turn-start timestamp arms the persist's turn-identity check exactly as
    // the route does.
    const turnOneStartedAtMs = Date.now()
    const turnText = await drainTurn(agent, "who is jesus?", thread, resource)
    if (!turnText.includes("grounded smoke answer")) {
      fail("turn_one_text_missing")
    }
    console.info("[followups-pg-smoke] event=turn_one_stored")

    // Seed a SIBLING metadata key first so the deep-merge claim is falsifiable
    // — a replace-style write would erase it.
    const { messages } = await persistMemory.recall({
      threadId: thread,
      resourceId: resource,
      perPage: 50,
    })
    const assistantRow = [...messages]
      .reverse()
      .find(
        (m) =>
          typeof m === "object" &&
          m !== null &&
          (m as { role?: unknown }).role === "assistant",
      ) as { id: string; createdAt?: unknown } | undefined
    if (!assistantRow) fail("assistant_row_missing_after_turn")
    await persistMemory.updateMessages({
      messages: [
        {
          id: assistantRow.id,
          content: { metadata: { smokeSibling: "survives" } },
        },
      ],
    })

    // 2. CLOCK-SKEW CHECK on the carrier window.
    //
    // The persist's carrier scan accepts a row only when its stored
    // `createdAt` falls inside [turnStartedAtMs, turnEndedAtMs], and both of
    // those stamps come from the APP clock (`Date.now()` in this process).
    // Which clock stamps `createdAt` therefore decides whether the feature
    // works at all: a DB-side stamp could land AFTER the upper bound on lag or
    // skew, the scan would reject the turn's OWN answer, the retry could never
    // satisfy it, and every persist would degrade to `no_carrier` — chips
    // live, then gone on reload, silently and for every turn.
    //
    // WHICH CLOCK STAMPS IT — settled by DIST READ, not by this assertion
    // (@mastra/pg 1.18.1, read 2026-08-20; same method and package the persist
    // module's header uses for the `updateMessages` deep-merge fact):
    //   - `saveMessages` BINDS the value — `const createdAt = message.createdAt
    //     || new Date()`, pushed into `$n` placeholders of
    //     `INSERT INTO <table> (id, thread_id, content, "createdAt",
    //     "createdAtZ", role, type, "resourceId") VALUES ...`. No column
    //     default, no `NOW()`.
    //   - the `trigger_set_timestamps` trigger, which DOES overwrite
    //     `createdAt` with `NOW()` on insert, is installed for `TABLE_SPANS`
    //     ONLY (`if (tableName === TABLE_SPANS)`), never for the messages
    //     table.
    // So message `createdAt` is app-clock, supplied by the caller, and the
    // upper bound is safe BY CONSTRUCTION — the stamp necessarily precedes the
    // route's post-turn capture. Re-read both facts on any `@mastra/*` bump; a
    // move to a column default or a widened trigger would invert this.
    //
    // WHAT THE ASSERTION BELOW ACTUALLY IS — read this before trusting it as
    // provenance evidence, because an earlier version of this comment
    // overclaimed exactly that (review, 2026-08-21). The upper bound is
    // sampled AFTER `drainTurn`'s trailing 300 ms sleep and after two store
    // round trips, so the row is necessarily inserted before the sample is
    // taken. `storedCreatedAtMs > turnOneEndedAtMs` therefore cannot fire
    // under EITHER hypothesis unless the database clock runs ahead of the app
    // clock by more than the measured headroom. App-clock and DB-clock
    // stamping produce an IDENTICAL PASS here, and the three printed numbers
    // do not separate them. This is a ±0.5 s clock-SKEW sanity check on the
    // window — useful, and it would catch a badly skewed test database — but
    // it is not the provenance proof; the dist read above is.
    //
    // MEASURED 2026-08-20, throwaway Postgres 16.14, @mastra/pg 1.18.1:
    //   created_at_minus_start_ms=489  end_minus_created_at_ms=336  window_ms=825
    // i.e. app and DB clocks agreed to well within the window on that run.
    const turnOneEndedAtMs = Date.now()
    const storedCreatedAtMs =
      assistantRow.createdAt instanceof Date
        ? assistantRow.createdAt.getTime()
        : typeof assistantRow.createdAt === "string"
          ? Date.parse(assistantRow.createdAt)
          : Number.NaN
    if (Number.isNaN(storedCreatedAtMs)) {
      fail("stored_created_at_unparseable")
    }
    // Report the observed offsets so an operator sees the actual headroom on
    // their database, not merely that the assertion held.
    console.info(
      `[followups-pg-smoke] event=clock_skew_check created_at_minus_start_ms=${storedCreatedAtMs - turnOneStartedAtMs} end_minus_created_at_ms=${turnOneEndedAtMs - storedCreatedAtMs} window_ms=${turnOneEndedAtMs - turnOneStartedAtMs}`,
    )
    if (storedCreatedAtMs < turnOneStartedAtMs) {
      fail("stored_created_at_before_turn_start")
    }
    if (storedCreatedAtMs > turnOneEndedAtMs) {
      // The clock-SKEW case (not the DB-stamp case — see the note above on
      // what this assertion can and cannot discriminate). Fails loudly HERE
      // rather than silently as `no_carrier` in production.
      fail("stored_created_at_after_turn_end")
    }

    // 3. Persist → replay round trip, with BOTH turn-identity bounds supplied
    // exactly as the route supplies them.
    const first = await persistSeekerFollowUps({
      memory: persistMemory,
      threadId: thread,
      resourceId: resource,
      questions: ["Why does prayer matter?", "Who wrote the gospels?"],
      turnStartedAtMs: turnOneStartedAtMs,
      turnEndedAtMs: turnOneEndedAtMs,
    })
    if (first !== "persisted") fail(`first_persist_${first}`)
    const firstReplay = await replayFollowUps(memory, thread, resource)
    if (
      JSON.stringify(firstReplay.followUps) !==
      JSON.stringify(["Why does prayer matter?", "Who wrote the gospels?"])
    ) {
      fail("first_replay_mismatch")
    }
    // Deep-merge preserved `parts`: the replayed text still renders.
    if (!firstReplay.lastText.includes("grounded smoke answer")) {
      fail("parts_lost_after_persist")
    }
    console.info("[followups-pg-smoke] event=first_persist_replayed")

    // Sibling metadata key survived the follow-ups write (deep-merge, not
    // replace) — read the raw row back.
    const afterPersist = await persistMemory.recall({
      threadId: thread,
      resourceId: resource,
      perPage: 50,
    })
    const rawRow = afterPersist.messages.find(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        (m as { id?: unknown }).id === assistantRow.id,
    ) as { content?: { metadata?: Record<string, unknown> } } | undefined
    const metadata = rawRow?.content?.metadata
    if (metadata?.smokeSibling !== "survives") {
      fail("sibling_metadata_lost")
    }
    if (!Array.isArray(metadata?.[SEEKER_FOLLOW_UPS_METADATA_KEY])) {
      fail("follow_ups_metadata_missing_raw")
    }
    console.info("[followups-pg-smoke] event=deep_merge_verified")

    // 4. Second persist OVERWRITES — never merges.
    const second = await persistSeekerFollowUps({
      memory: persistMemory,
      threadId: thread,
      resourceId: resource,
      questions: ["Only the fresh question?"],
      turnStartedAtMs: turnOneStartedAtMs,
      turnEndedAtMs: Date.now(),
    })
    if (second !== "persisted") fail(`second_persist_${second}`)
    const secondReplay = await replayFollowUps(memory, thread, resource)
    if (
      JSON.stringify(secondReplay.followUps) !==
      JSON.stringify(["Only the fresh question?"])
    ) {
      fail("second_persist_did_not_overwrite")
    }
    console.info("[followups-pg-smoke] event=overwrite_verified")

    // 5. The next turn on a metadata-carrying thread streams normally.
    const turnTwoStartedAtMs = Date.now()
    const turnTwo = await drainTurn(agent, "tell me more", thread, resource)
    if (!turnTwo.includes("grounded smoke answer")) {
      fail("turn_two_after_metadata_failed")
    }
    console.info("[followups-pg-smoke] event=next_turn_streams_normally")

    // 6. A persist for turn TWO targets turn two's message — the multi-turn
    // carrier shape a single-turn store cannot discriminate (adversarial
    // review): turn one's carrier keeps its stored set, and the replay wire
    // (last-turn-only) now serves the new set from the NEW last message.
    const third = await persistSeekerFollowUps({
      memory: persistMemory,
      threadId: thread,
      resourceId: resource,
      questions: ["A turn-two question?"],
      turnStartedAtMs: turnTwoStartedAtMs,
      turnEndedAtMs: Date.now(),
    })
    if (third !== "persisted") fail(`turn_two_persist_${third}`)
    const thirdReplay = await replayFollowUps(memory, thread, resource)
    if (
      JSON.stringify(thirdReplay.followUps) !==
      JSON.stringify(["A turn-two question?"])
    ) {
      fail("turn_two_persist_missed_its_carrier")
    }
    // Turn one's carrier kept its own stored set (off the wire, but stored).
    const finalRows = await persistMemory.recall({
      threadId: thread,
      resourceId: resource,
      perPage: 50,
    })
    const turnOneRaw = finalRows.messages.find(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        (m as { id?: unknown }).id === assistantRow.id,
    ) as { content?: { metadata?: Record<string, unknown> } } | undefined
    const turnOneStored =
      turnOneRaw?.content?.metadata?.[SEEKER_FOLLOW_UPS_METADATA_KEY]
    if (
      JSON.stringify(turnOneStored) !==
      JSON.stringify(["Only the fresh question?"])
    ) {
      fail("turn_two_persist_clobbered_turn_one_carrier")
    }
    console.info("[followups-pg-smoke] event=turn_two_carrier_targeted")

    console.info("[followups-pg-smoke] event=passed")
  } finally {
    // Best-effort cleanup: a throwaway DB tolerates residue.
    try {
      const store = memory as unknown as {
        deleteThread?: (threadId: string) => Promise<void>
      }
      await store.deleteThread?.(thread)
    } catch {
      // Residue accepted on a throwaway target.
    }
  }
  // The pg pool keeps the event loop alive; the smoke's assertions are done.
  process.exit(0)
}

void main().catch((error: unknown) => {
  // No error DETAIL beyond the class name — connection strings can embed
  // credentials and store errors can embed row content.
  fail(
    error instanceof Error
      ? `unhandled_${error.constructor.name}`
      : "unhandled_unknown",
  )
})
