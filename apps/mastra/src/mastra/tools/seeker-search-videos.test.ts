import { readFileSync } from "node:fs"

import { Agent } from "@mastra/core/agent"
import { MockLanguageModelV3, simulateReadableStream } from "ai/test"
import { describe, expect, it, vi } from "vitest"

import {
  createSeekerSearchVideosTool,
  executeSeekerSearchVideos,
  seekerSearchVideosOutputSchema,
  SEEKER_SEARCH_VIDEOS_LIMIT,
  SEEKER_SEARCH_VIDEOS_LOCALE,
  SEEKER_SEARCH_VIDEOS_MAX_CALLS_PER_TURN,
  SEEKER_SEARCH_VIDEOS_TOOL_NAME,
  type SeekerSearchVideosOutput,
} from "./seeker-search-videos"
import { projectVideo } from "../agents/seeker-route"

/**
 * Seeker `searchVideos` tool (feat-327, plan P4).
 *
 * The headline scenario here is the E10 blind spot: with locale `en` almost
 * every playable row IS `target_audio`, so a fixture built from real English
 * traffic leaves the target_audio filter VACUOUSLY green. Every filter test
 * below therefore carries rows that only the drop branch can match.
 */

type ClientRow = {
  videoId: string
  title: string
  snippet: string
  slug: string
  imageUrl: string | null
  playbackId?: string
  durationSeconds?: number | null
  languageSlug?: string | null
  availability?: { kind: string }
}

function row(over: Partial<ClientRow> & { videoId: string }): ClientRow {
  return {
    title: `Title ${over.videoId}`,
    snippet: `Snippet ${over.videoId}`,
    slug: `slug-${over.videoId}`,
    imageUrl: null,
    playbackId: `playback${over.videoId}xyz`,
    durationSeconds: 100,
    languageSlug: "english",
    availability: { kind: "target_audio" },
    ...over,
  }
}

function okSearch(rows: ClientRow[]) {
  return vi.fn(async (_input: unknown) => ({
    ok: true as const,
    data: { videos: rows },
  }))
}

function failingSearch(reason: string) {
  return vi.fn(async (_input: unknown) => ({
    ok: false as const,
    reason: reason as "auth_failed",
    retryable: false,
  }))
}

function captureLogs() {
  const lines: string[] = []
  return { lines, logSink: (line: string) => lines.push(line) }
}

/**
 * Invoke a tool the way Mastra does: `(inputData, context)`. This tool's
 * execute ignores the context, so an empty one is faithful; the cast keeps the
 * framework's `TSchemaOut | ValidationError | void` return union out of every
 * assertion below.
 */
async function callSearchTool(
  tool: ReturnType<typeof createSeekerSearchVideosTool>,
  input: { q: string },
): Promise<SeekerSearchVideosOutput> {
  const execute = tool.execute
  if (!execute) throw new Error("seeker search tool has no execute")
  const context = {} as Parameters<typeof execute>[1]
  return (await execute(input, context)) as SeekerSearchVideosOutput
}

// A query text sentinel distinctive enough that any accidental interpolation
// into a log line is unmistakable.
const SENSITIVE_QUERY = "why-does-god-allow-suffering-SENTINEL"

describe("seeker search tool — identity pins", () => {
  it("registers under the tool name the route resolves search results from", () => {
    // The route matches tool-result chunks on this exact string and imports
    // THIS constant to do it, so the literal is pinned once, here.
    expect(createSeekerSearchVideosTool().id).toBe(
      SEEKER_SEARCH_VIDEOS_TOOL_NAME,
    )
    expect(SEEKER_SEARCH_VIDEOS_TOOL_NAME).toBe("searchVideos")
  })
})

describe("executeSeekerSearchVideos — pinned call shape (plan D5/P4)", () => {
  it("pins locale 'en' and limit 8; the model only supplies q", async () => {
    const search = okSearch([])
    const { logSink } = captureLogs()
    await executeSeekerSearchVideos({ q: "storm" }, { search, logSink })

    expect(search.mock.calls[0][0]).toEqual({
      q: "storm",
      locale: SEEKER_SEARCH_VIDEOS_LOCALE,
      limit: SEEKER_SEARCH_VIDEOS_LIMIT,
    })
    // Not a literal: pins the values operators/plan cite, so a drift in either
    // constant re-enters this assertion.
    expect(SEEKER_SEARCH_VIDEOS_LOCALE).toBe("en")
    expect(SEEKER_SEARCH_VIDEOS_LIMIT).toBe(8)
  })
})

describe("executeSeekerSearchVideos — featurability filter (E10 blind spot)", () => {
  it("REQUIRED: a mixed-kind fixture of PLAYABLE rows returns ONLY the target_audio ones", async () => {
    // Every row here has a valid playbackId, so playability cannot be what
    // drops the non-target_audio rows — only the availability filter can.
    //
    // SYNTHETIC FIXTURE NOTE (2026-08-03): the playable `target_subtitle` row
    // is deliberately synthetic. Admin's `watchabilityFromSubtitle` hardcodes
    // `playbackId: null`, so a playable target_subtitle row is unreachable
    // through the agent-tools playability filter today; only `target_audio`
    // and `related_language` reach this client's wire. It is kept because this
    // is a CLIENT-level filter contract that needs no production
    // reachability — and `related_language` below is the production-reachable
    // sibling covering the same drop branch. Re-check that claim if
    // `watchabilityFromSubtitle` changes.
    const search = okSearch([
      row({ videoId: "audio1", availability: { kind: "target_audio" } }),
      row({ videoId: "sub1", availability: { kind: "target_subtitle" } }),
      row({ videoId: "rel1", availability: { kind: "related_language" } }),
      row({ videoId: "missing1", availability: undefined }),
      row({ videoId: "audio2", availability: { kind: "target_audio" } }),
    ])
    const { logSink } = captureLogs()

    const result = await executeSeekerSearchVideos(
      { q: "storm" },
      { search, logSink },
    )

    expect(result.videos.map((v) => v.videoId)).toEqual(["audio1", "audio2"])
  })

  it("fail-closes an UNKNOWN availability kind (plan P5 direction)", async () => {
    const search = okSearch([
      row({ videoId: "future1", availability: { kind: "some_future_kind" } }),
    ])
    const { logSink } = captureLogs()

    const result = await executeSeekerSearchVideos(
      { q: "storm" },
      { search, logSink },
    )

    // Availability vocabulary drift stops featuring; it never leaks a
    // wrong-language row.
    expect(result.videos).toEqual([])
  })

  it("drops rows lacking a usable playbackId, including a pre-widening response", async () => {
    const search = okSearch([
      // Pre-widening admin: no playback fields, no availability at all.
      {
        videoId: "old1",
        title: "Old",
        snippet: "Old",
        slug: "old",
        imageUrl: null,
      },
      row({ videoId: "empty1", playbackId: "" }),
      row({ videoId: "good1" }),
    ])
    const { logSink } = captureLogs()

    const result = await executeSeekerSearchVideos(
      { q: "storm" },
      { search, logSink },
    )

    expect(result.videos.map((v) => v.videoId)).toEqual(["good1"])
  })
})

describe("executeSeekerSearchVideos — D9 shape gates at the tool boundary", () => {
  // Added 2026-08-04 on production evidence: 2 of 132 sampled featurable
  // videos carried non-ASCII slugs. Before this filter such a row was shown to
  // the model, could be DECLARED, and then silently attached nothing at the
  // route (reason=projection_failed) while the reply still offered a video.
  //
  // Every fixture below is playable AND target_audio, so semantics cannot be
  // what drops it — only the shape gate can.

  it("REQUIRED: drops a playable target_audio row whose slug is the ONLY invalid field", async () => {
    // The real production shape: la-búsqueda-the-search is a genuine admin
    // catalog slug with no published watch page (404 in both accented and
    // ASCII-folded URL forms, absent from every sitemap part, 2026-08-04).
    const search = okSearch([
      row({ videoId: "good1" }),
      isolatedRow({ videoId: "accented", slug: "la-búsqueda-the-search" }),
      row({ videoId: "good2" }),
    ])
    const { logSink } = captureLogs()

    const result = await executeSeekerSearchVideos(
      { q: "storm" },
      { search, logSink },
    )

    expect(result.videos.map((v) => v.videoId)).toEqual(["good1", "good2"])
  })

  /**
   * A row with KNOWN-GOOD values for every shape-gated field, so a caller can
   * invalidate exactly ONE and know which gate rejected it.
   *
   * This exists because `row()` DERIVES `slug` (`slug-${videoId}`) and
   * `playbackId` (`playback${videoId}xyz`) from the videoId — so
   * `row({ videoId: "has space" })` fails the videoId, slug AND playbackId
   * gates at once and proves nothing about any of them. That trap has now
   * produced three vacuous tests in this branch's history; isolating it in a
   * helper is cheaper than remembering it at every call site.
   */
  function isolatedRow(over: Partial<ClientRow> & { videoId: string }) {
    return row({
      slug: "ok-slug",
      playbackId: "abcd1234",
      languageSlug: "english",
      ...over,
    })
  }

  it("drops a row whose videoId is the ONLY invalid field", async () => {
    // Isolated on purpose: slug and playbackId are pinned valid, so
    // VIDEO_ID_PATTERN is the only gate that can reject this row.
    const search = okSearch([
      isolatedRow({ videoId: "has space" }),
      isolatedRow({ videoId: "good1" }),
    ])
    const { logSink } = captureLogs()

    const result = await executeSeekerSearchVideos(
      { q: "storm" },
      { search, logSink },
    )

    expect(result.videos.map((v) => v.videoId)).toEqual(["good1"])
  })

  it("drops a row whose playbackId is the ONLY invalid field", async () => {
    const search = okSearch([
      isolatedRow({ videoId: "badplayback", playbackId: "short" }),
      isolatedRow({ videoId: "good1" }),
    ])
    const { logSink } = captureLogs()

    const result = await executeSeekerSearchVideos(
      { q: "storm" },
      { search, logSink },
    )

    expect(result.videos.map((v) => v.videoId)).toEqual(["good1"])
  })

  it("drops a row whose languageSlug is the ONLY invalid field", async () => {
    const search = okSearch([
      isolatedRow({ videoId: "badlang", languageSlug: "Français" }),
      isolatedRow({ videoId: "good1" }),
    ])
    const { logSink } = captureLogs()

    const result = await executeSeekerSearchVideos(
      { q: "storm" },
      { search, logSink },
    )

    expect(result.videos.map((v) => v.videoId)).toEqual(["good1"])
  })

  it("keeps a row whose languageSlug is ABSENT (absent is legitimate, malformed is not)", async () => {
    const search = okSearch([row({ videoId: "good1", languageSlug: null })])
    const { logSink } = captureLogs()

    const result = await executeSeekerSearchVideos(
      { q: "storm" },
      { search, logSink },
    )

    expect(result.videos.map((v) => v.videoId)).toEqual(["good1"])
  })

  it("keeps boundary-legal shapes (anti-vacuous companion)", async () => {
    // Without this, a filter that rejected EVERYTHING would satisfy all three
    // tests above.
    const search = okSearch([
      row({
        videoId: "a".repeat(64),
        playbackId: "abcd1234",
        slug: `a${"b".repeat(80)}`,
        languageSlug: "brazilian-portuguese_1",
      }),
    ])
    const { logSink } = captureLogs()

    const result = await executeSeekerSearchVideos(
      { q: "storm" },
      { search, logSink },
    )

    expect(result.videos).toHaveLength(1)
  })

  it("reports shape drops separately from a retrieval miss in the count line", async () => {
    // The operator-facing discriminator: target_audio counts rows that passed
    // SEMANTICS, shape_dropped how many of those the shape gate then removed.
    // Zero results with shape_dropped=2 is a catalog-shape problem; zero with
    // shape_dropped=0 is genuine retrieval.
    const search = okSearch([
      row({ videoId: "accented", slug: "la-búsqueda-the-search" }),
      row({ videoId: "accented2", slug: "tümlükden-nura" }),
      row({ videoId: "good1" }),
    ])
    const { lines, logSink } = captureLogs()

    await executeSeekerSearchVideos({ q: "storm" }, { search, logSink })

    expect(lines).toContain(
      "[seeker-search] event=video_candidates_filtered returned=3 playable=3 target_audio=3 availability_missing=0 shape_dropped=2",
    )
  })

  it("logs no slug or query text when a row is shape-dropped", async () => {
    // A dropped row's slug is catalog data, but the line must stay enum/count
    // only — the same discipline as every other branch here.
    const { lines, logSink } = captureLogs()
    const search = okSearch([
      row({ videoId: "accented", slug: "la-búsqueda-the-search" }),
    ])

    await executeSeekerSearchVideos({ q: SENSITIVE_QUERY }, { search, logSink })

    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line).not.toContain("búsqueda")
      expect(line).not.toContain(SENSITIVE_QUERY)
    }
  })
})

describe("executeSeekerSearchVideos — output projection (plan P4)", () => {
  it("projects field-by-field: every route-required field present, nothing extra", async () => {
    const search = okSearch([
      {
        ...row({ videoId: "v1" }),
        // A field the client parses but the seeker output must NOT carry.
        imageUrl: "https://cdn.example/hero.png",
        // A field a FUTURE admin might add — a spread would leak it.
        experimentalScore: 0.91,
      } as ClientRow,
    ])
    const { logSink } = captureLogs()

    const result = await executeSeekerSearchVideos(
      { q: "storm" },
      { search, logSink },
    )

    expect(result.videos).toStrictEqual([
      {
        videoId: "v1",
        title: "Title v1",
        snippet: "Snippet v1",
        slug: "slug-v1",
        playbackId: "playbackv1xyz",
        durationSeconds: 100,
        languageSlug: "english",
        availability: { kind: "target_audio" },
      },
    ])
  })

  it("normalizes absent durationSeconds/languageSlug to null (never undefined on the row)", async () => {
    const search = okSearch([
      row({
        videoId: "v1",
        durationSeconds: undefined,
        languageSlug: undefined,
      }),
    ])
    const { logSink } = captureLogs()

    const result = await executeSeekerSearchVideos(
      { q: "storm" },
      { search, logSink },
    )

    expect(result.videos[0]).toMatchObject({
      durationSeconds: null,
      languageSlug: null,
    })
  })

  it("PASSES THROUGH availability.kind rather than stamping the constant", () => {
    // Discriminating by construction: the filter only admits target_audio
    // rows, so no fixture can distinguish pass-through from stamping through
    // the executor. Read the projection source instead and pin the ABSENCE of
    // a `?? SEEKER_FEATURABLE_AVAILABILITY_KIND` fallback on this field.
    //
    // Why it matters: `availability.kind` is the ONE field the route
    // independently re-asserts (plan D9 belt-and-braces). If this tool
    // synthesized it, that re-assert would pass vacuously the moment the
    // filter above loosened — the tool would stamp "target_audio" onto a row
    // that is not, and the route would believe it.
    const source = readFileSync(
      new URL("./seeker-search-videos.ts", import.meta.url),
      "utf8",
    )
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
    expect(code).toMatch(
      /availability:\s*\{\s*kind:\s*row\.availability\.kind\s*\}/,
    )
    expect(code).not.toMatch(/kind:[^\n]*\?\?/)
  })

  it("output completeness: the schema carries every field the route projection reads", () => {
    // Plan P4: the /forge-seeker declaration projection reads these rows out of
    // the tool RESULT chunks, so trimming the output to a model-friendly subset
    // breaks every declaration at RUNTIME (reason=projection_failed) with no
    // test going red. Deleting any name below from the output schema fails HERE
    // instead. `availability` is on the list because the route re-asserts
    // target_audio on the declared row (plan D9 belt-and-braces).
    const REQUIRED_BY_ROUTE_PROJECTION = [
      "videoId",
      "title",
      "slug",
      "playbackId",
      "durationSeconds",
      "languageSlug",
      "availability",
    ]
    const rowShape = seekerSearchVideosOutputSchema.shape.videos.element.shape
    for (const field of REQUIRED_BY_ROUTE_PROJECTION) {
      expect(Object.keys(rowShape)).toContain(field)
    }
  })
})

describe("executeSeekerSearchVideos — filter observability (plan P4)", () => {
  it("emits the count line, with availability_missing over ALL returned rows", async () => {
    const search = okSearch([
      row({ videoId: "audio1" }),
      row({ videoId: "rel1", availability: { kind: "related_language" } }),
      // Missing availability AND unplayable — counted in availability_missing
      // regardless of playability, because that count is the operator's
      // admin-contract signal (runbook step 3), not a featurability metric.
      { videoId: "old1", title: "O", snippet: "O", slug: "o", imageUrl: null },
      row({ videoId: "missing2", availability: undefined }),
    ])
    const { lines, logSink } = captureLogs()

    await executeSeekerSearchVideos({ q: "storm" }, { search, logSink })

    expect(lines).toContain(
      "[seeker-search] event=video_candidates_filtered returned=4 playable=3 target_audio=1 availability_missing=2 shape_dropped=0",
    )
  })

  it("reports availability_missing=0 when admin serves the field on every row", async () => {
    // Anti-vacuous companion: the count must actually vary with the fixture,
    // or a hardcoded 0 would satisfy the operator's "contract vs retrieval"
    // discriminator while telling them nothing.
    const search = okSearch([
      row({ videoId: "audio1" }),
      row({ videoId: "rel1", availability: { kind: "related_language" } }),
    ])
    const { lines, logSink } = captureLogs()

    await executeSeekerSearchVideos({ q: "storm" }, { search, logSink })

    expect(lines).toContain(
      "[seeker-search] event=video_candidates_filtered returned=2 playable=2 target_audio=1 availability_missing=0 shape_dropped=0",
    )
  })

  it("logs an enum reason and degrades to empty on any client failure", async () => {
    const { lines, logSink } = captureLogs()

    const result = await executeSeekerSearchVideos(
      { q: "storm" },
      { search: failingSearch("auth_failed"), logSink },
    )

    expect(result).toEqual({ videos: [] })
    expect(lines).toEqual([
      "[seeker-search] event=video_search_unavailable reason=auth_failed",
    ])
  })
})

describe("seeker search tool — per-turn call cap (plan P4)", () => {
  it("returns empty + an enum log on the third call within one turn", async () => {
    const search = okSearch([row({ videoId: "v1" })])
    const { lines, logSink } = captureLogs()
    const tool = createSeekerSearchVideosTool({ search, logSink })

    const first = await callSearchTool(tool, { q: "a" })
    const second = await callSearchTool(tool, { q: "b" })
    const third = await callSearchTool(tool, { q: "c" })

    expect(first.videos).toHaveLength(1)
    expect(second.videos).toHaveLength(1)
    expect(third).toEqual({ videos: [] })
    // The capped call never reached the client.
    expect(search).toHaveBeenCalledTimes(
      SEEKER_SEARCH_VIDEOS_MAX_CALLS_PER_TURN,
    )
    expect(lines).toContain(
      "[seeker-search] event=video_search_cap_exceeded calls=3 max=2",
    )
  })

  it("resets across turns: a freshly minted tool starts with a fresh budget", async () => {
    // The cap is per-TURN, not per-process. Module or closure state shared
    // across resolutions would leak one user's cap into the next user's turn
    // in this shared process; the agent mints a fresh instance per invocation.
    const search = okSearch([row({ videoId: "v1" })])
    const { logSink } = captureLogs()

    const turnOne = createSeekerSearchVideosTool({ search, logSink })
    await callSearchTool(turnOne, { q: "a" })
    await callSearchTool(turnOne, { q: "b" })
    expect(await callSearchTool(turnOne, { q: "c" })).toEqual({ videos: [] })

    const turnTwo = createSeekerSearchVideosTool({ search, logSink })
    expect((await callSearchTool(turnTwo, { q: "d" })).videos).toHaveLength(1)
  })
})

describe("seeker search tool — query text never reaches a log (plan P4 data handling)", () => {
  it("logs no query text on ANY branch: success, empty, cap-hit, client failure", async () => {
    // `q` is a model-formulated paraphrase of a religious-belief conversation
    // (special-category territory). One escape on one branch is a leak, so all
    // four branches are swept in a single test.
    const { lines, logSink } = captureLogs()

    const okTool = createSeekerSearchVideosTool({
      search: okSearch([row({ videoId: "v1" })]),
      logSink,
    })
    await callSearchTool(okTool, { q: SENSITIVE_QUERY }) // success
    await callSearchTool(okTool, { q: SENSITIVE_QUERY })
    await callSearchTool(okTool, { q: SENSITIVE_QUERY }) // cap-hit

    const emptyTool = createSeekerSearchVideosTool({
      search: okSearch([]),
      logSink,
    })
    await callSearchTool(emptyTool, { q: SENSITIVE_QUERY }) // empty

    const failTool = createSeekerSearchVideosTool({
      search: failingSearch("timeout"),
      logSink,
    })
    await callSearchTool(failTool, { q: SENSITIVE_QUERY }) // client failure

    // Anti-vacuous: all four branches really did log something.
    expect(lines.length).toBeGreaterThanOrEqual(5)
    for (const line of lines) {
      expect(line).not.toContain(SENSITIVE_QUERY)
      expect(line).not.toContain("SENTINEL")
    }
  })

  it("logs no title or snippet text either", async () => {
    const { lines, logSink } = captureLogs()
    const search = okSearch([
      row({
        videoId: "v1",
        title: "TITLE-SENTINEL",
        snippet: "SNIPPET-SENTINEL",
      }),
    ])

    await executeSeekerSearchVideos({ q: "storm" }, { search, logSink })

    for (const line of lines) {
      expect(line).not.toContain("TITLE-SENTINEL")
      expect(line).not.toContain("SNIPPET-SENTINEL")
    }
  })
})

// ===========================================================================
// The per-turn cap, verified at the layer the claim actually lives on
// ===========================================================================
//
// Everything above exercises the FACTORY. None of it could catch a Mastra
// release that changed WHEN function-valued `tools` are resolved, which is what
// makes an instance-closure counter a per-TURN cap at all. A per-step
// resolution would silently reset the counter mid-turn and leave the cap
// unenforceable in production with CI green.
//
// So these two run REAL multi-step agent turns against a stub model and assert
// the outcome that matters — how many times the HTTP client is actually hit.
//
// Measured against @mastra/core 1.55.0 (2026-08-03) by exactly these tests: the
// resolver is invoked TWICE per `agent.stream()`, a fixed count independent of
// step count (both at setup, not per step), and the instance actually wired for
// execution stays stable for the whole turn. That double invocation is why the
// factory must stay cheap — it builds one throwaway tool object per turn — and
// it is harmless to the counter. These tests ARE the re-verification on any
// `@mastra/*` bump; nothing here needs re-checking by hand.

const MOCK_USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

type DoStreamReturn = Awaited<ReturnType<MockLanguageModelV3["doStream"]>>
type StreamPart = DoStreamReturn extends { stream: ReadableStream<infer P> }
  ? P
  : never

/**
 * Calls searchVideos on the first `searchSteps` steps of EACH turn, then
 * answers in text.
 *
 * The step index is derived from the incoming prompt (how many tool messages
 * the conversation already carries) rather than from a closure counter, so it
 * is per-TURN by construction. A closure counter would keep climbing across
 * turns, silently making turn 2 of a same-agent test issue zero tool calls —
 * which would let a broken per-turn cap pass.
 */
function searchNTimesModel(searchSteps: number): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async ({ prompt }) => {
      const toolMessages = (
        prompt as unknown as Array<{ role?: string }>
      ).filter((m) => m?.role === "tool").length
      const call = toolMessages + 1
      const chunks: StreamPart[] =
        call <= searchSteps
          ? [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: `search-${call}-${toolMessages}`,
                toolName: "searchVideos",
                input: JSON.stringify({ q: `${SENSITIVE_QUERY} ${call}` }),
              },
              {
                type: "finish",
                finishReason: {
                  unified: "tool-calls" as const,
                  raw: "tool_calls",
                },
                usage: MOCK_USAGE,
              },
            ]
          : [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "0" },
              { type: "text-delta", id: "0", delta: "done" },
              { type: "text-end", id: "0" },
              {
                type: "finish",
                finishReason: { unified: "stop" as const, raw: "stop" },
                usage: MOCK_USAGE,
              },
            ]
      return {
        stream: simulateReadableStream<StreamPart>({
          initialDelayInMs: null,
          chunkDelayInMs: null,
          chunks,
        }),
      }
    },
  })
}

type ToolResultChunk = {
  payload?: { toolName?: string; result?: { videos?: unknown[] } }
}

/** Mirrors the agent's production wiring: a fresh tool instance per resolution. */
function buildCappedAgent(
  searchSteps: number,
  options: {
    search: ReturnType<typeof okSearch>
    logSink: (l: string) => void
  },
): Agent {
  return new Agent({
    id: `seeker-cap-probe-${searchSteps}`,
    name: "Seeker Cap Probe",
    instructions: "Test stand-in for the seeker agent.",
    model: searchNTimesModel(searchSteps),
    tools: () => ({ searchVideos: createSeekerSearchVideosTool(options) }),
  })
}

async function runTurn(agent: Agent): Promise<ToolResultChunk[]> {
  const output = await agent.stream("go", { maxSteps: 8 })
  // The turn only advances while the text stream is consumed.
  for await (const chunk of output.textStream) {
    void chunk
  }
  return (await output.toolResults) as ToolResultChunk[]
}

describe("per-turn call cap — real multi-step agent turn", () => {
  it("lets a third searchVideos call through as EMPTY without hitting the client again", async () => {
    const search = okSearch([row({ videoId: "v1" })])
    const { lines, logSink } = captureLogs()
    const agent = buildCappedAgent(3, { search, logSink })

    const toolResults = await runTurn(agent)

    // Anti-vacuous: the model really did call the tool three times in ONE turn.
    expect(toolResults).toHaveLength(3)
    // The cap bites where it matters — the third call never reaches admin, so
    // it spends no bearer, no rate-limit budget, and no admin work.
    expect(search).toHaveBeenCalledTimes(
      SEEKER_SEARCH_VIDEOS_MAX_CALLS_PER_TURN,
    )
    expect(
      toolResults.map((chunk) => chunk.payload?.result?.videos?.length),
    ).toEqual([1, 1, 0])
    expect(lines).toContain(
      "[seeker-search] event=video_search_cap_exceeded calls=3 max=2",
    )
  })

  it("resets the budget on the next turn of the SAME long-lived agent", async () => {
    // THE production shape: `seekerAgent` is a module-level singleton serving
    // every turn of the process, so "one agent, two stream() calls" is the
    // configuration the cap must hold under. A two-DIFFERENT-agents version of
    // this test proves only that a fresh object starts fresh — which is true of
    // any object — and would stay green if the counter were hoisted to module
    // scope behind a per-agent cache.
    //
    // The failure it rules out is nasty and invisible: a counter that survived
    // across turns would exhaust once and then silently refuse every later
    // search, for every user, until the process restarted.
    const search = okSearch([row({ videoId: "v1" })])
    const { logSink } = captureLogs()
    const agent = buildCappedAgent(3, { search, logSink })

    const turnOne = await runTurn(agent)
    expect(search).toHaveBeenCalledTimes(2)
    expect(
      turnOne.map((chunk) => chunk.payload?.result?.videos?.length),
    ).toEqual([1, 1, 0])

    const turnTwo = await runTurn(agent)

    // Two MORE client calls, not zero: turn two got a full budget.
    expect(search).toHaveBeenCalledTimes(4)
    expect(
      turnTwo.map((chunk) => chunk.payload?.result?.videos?.length),
    ).toEqual([1, 1, 0])
  })

  it("keeps two CONCURRENT turns on one agent independent (no shared budget)", async () => {
    // The other half of what a closure-per-instance buys: overlapping turns
    // from different users in this single shared process must not consume each
    // other's budget. A module-scoped counter would let 2 concurrent turns of
    // 3 calls each yield 2 client calls total instead of 4.
    const search = okSearch([row({ videoId: "v1" })])
    const { logSink } = captureLogs()
    const agent = buildCappedAgent(3, { search, logSink })

    const [a, b] = await Promise.all([runTurn(agent), runTurn(agent)])

    expect(search).toHaveBeenCalledTimes(4)
    for (const turn of [a, b]) {
      expect(turn.map((c) => c.payload?.result?.videos?.length)).toEqual([
        1, 1, 0,
      ])
    }
  })

  it("logs no query text even when the query travels through the real tool-call path", async () => {
    // The other branch tests hand `q` straight to the executor. This one lets
    // the MODEL supply it through Mastra's tool-call plumbing, which is the
    // path production actually takes.
    const search = okSearch([row({ videoId: "v1" })])
    const { lines, logSink } = captureLogs()

    await runTurn(buildCappedAgent(3, { search, logSink }))

    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line).not.toContain(SENSITIVE_QUERY)
      expect(line).not.toContain("SENTINEL")
    }
  })
})

// ===========================================================================
// Cross-boundary equivalence: the tool admits exactly what the route accepts
// ===========================================================================
//
// The two boundaries are supposed to agree on featurability. When they DRIFT,
// the failure is silent and user-visible: the model is shown a candidate, it
// declares it, and the turn attaches nothing while the reply text still offers
// a video.
//
// Per-gate tests cannot catch drift, because each one only ever exercises the
// gates someone remembered to write on BOTH sides. This table runs one fixture
// set through the tool's filter AND the route's `projectVideo` and asserts the
// verdicts match — so a gate added to either side alone goes red here. It is
// what would have caught the `title` divergence (the route rejected an empty
// title; the tool did not) instead of a reviewer finding it by inspection.

describe("tool boundary and route projection agree on featurability", () => {
  const CASES: Array<{ label: string; row: ClientRow; featurable: boolean }> = [
    { label: "fully valid", row: row({ videoId: "ok1" }), featurable: true },
    {
      label: "empty title",
      row: row({ videoId: "ok2", title: "" }),
      featurable: false,
    },
    {
      label: "videoId with a space",
      row: row({ videoId: "bad id", slug: "ok-slug", playbackId: "abcd1234" }),
      featurable: false,
    },
    {
      label: "videoId over 64 chars",
      row: row({
        videoId: "a".repeat(65),
        slug: "ok-slug",
        playbackId: "abcd1234",
      }),
      featurable: false,
    },
    {
      label: "playbackId too short",
      row: row({ videoId: "ok3", playbackId: "short", slug: "ok-slug" }),
      featurable: false,
    },
    {
      label: "playbackId over 64 chars",
      row: row({ videoId: "ok4", playbackId: "a".repeat(65), slug: "ok-slug" }),
      featurable: false,
    },
    {
      label: "non-ASCII slug (real production row)",
      row: row({
        videoId: "ok5",
        slug: "la-búsqueda-the-search",
        playbackId: "abcd1234",
      }),
      featurable: false,
    },
    {
      label: "slug with a traversal segment",
      row: row({
        videoId: "ok6",
        slug: "../../etc/passwd",
        playbackId: "abcd1234",
      }),
      featurable: false,
    },
    {
      label: "odd-cased slug",
      row: row({ videoId: "ok7", slug: "Jesus-Calms", playbackId: "abcd1234" }),
      featurable: false,
    },
    {
      label: "absent languageSlug",
      row: row({ videoId: "ok8", languageSlug: null }),
      featurable: true,
    },
    {
      label: "malformed languageSlug",
      row: row({ videoId: "ok9", languageSlug: "Français" }),
      featurable: false,
    },
    {
      label: "non-target_audio availability",
      row: row({ videoId: "ok10", availability: { kind: "related_language" } }),
      featurable: false,
    },
    {
      label: "boundary-legal maximums",
      row: row({
        videoId: "a".repeat(64),
        playbackId: "a".repeat(64),
        slug: `a${"b".repeat(80)}`,
        languageSlug: "brazilian-portuguese_1",
      }),
      featurable: true,
    },
  ]

  it.each(CASES)(
    "$label: tool and route reach the same verdict",
    async ({ row: fixture, featurable }) => {
      const { logSink } = captureLogs()
      const toolOut = await executeSeekerSearchVideos(
        { q: "storm" },
        { search: okSearch([fixture]), logSink },
      )
      const toolAdmits = toolOut.videos.length === 1

      // The route sees the tool's OUTPUT row when the tool admits it, and the
      // raw client row when it does not — either way, the question is whether
      // projectVideo would accept this candidate.
      const routeAccepts =
        projectVideo(toolAdmits ? toolOut.videos[0] : fixture) !== null

      expect({ toolAdmits, routeAccepts }).toStrictEqual({
        toolAdmits: featurable,
        routeAccepts: featurable,
      })
    },
  )

  it("covers both verdicts (anti-vacuous)", () => {
    // A table of all-reject or all-accept cases would make the equivalence
    // assertion trivially satisfiable.
    expect(CASES.some((c) => c.featurable)).toBe(true)
    expect(CASES.some((c) => !c.featurable)).toBe(true)
  })
})
