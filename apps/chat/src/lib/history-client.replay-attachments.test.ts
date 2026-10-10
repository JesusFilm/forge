/**
 * Replay attachment parsing (feat-329): the replay wire's optional
 * `sources`/`video` are re-validated through the SAME projections the live
 * wire uses, malformed fields degrade to absent (never a failed replay), and
 * the video-projection diagnostic is AGGREGATED so one thread open is one log
 * line rather than a burst.
 */

import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchHistoryThread } from "./history-client"

const VIDEO = {
  videoId: "vid-1",
  title: "Jesus calms the storm",
  slug: "jesus-calms-the-storm",
  playbackId: "abcdefgh12345678",
  durationSeconds: 120,
  languageSlug: "english",
}

const SOURCE = {
  sourceName: "Source A",
  title: "Title A",
  url: "https://example.org/a",
  score: 0.9,
  snippet: "snippet",
}

function respondWith(messages: unknown[]): typeof fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify({ messages }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  ) as unknown as typeof fetch
}

async function replay(messages: unknown[]) {
  const result = await fetchHistoryThread({
    conversationId: "c1",
    fetchImpl: respondWith(messages),
  })
  expect(result.ok).toBe(true)
  return result.ok ? result.messages : []
}

function assistant(over: Record<string, unknown> = {}): unknown {
  return {
    id: "m1",
    role: "assistant",
    text: "Here is one.",
    createdAt: "2026-08-04T12:00:00.000Z",
    ...over,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("fetchHistoryThread — replay attachments", () => {
  it("parses a replayed video into the client-built watchUrl shape", async () => {
    const messages = await replay([assistant({ video: VIDEO })])

    expect(messages[0].video).toStrictEqual({
      videoId: "vid-1",
      title: "Jesus calms the storm",
      playbackId: "abcdefgh12345678",
      durationSeconds: 120,
      // Built HERE from the validated slugs — never trusted from the wire.
      watchUrl: "https://www.jesusfilm.org/watch/jesus-calms-the-storm.html",
    })
  })

  it("parses replayed sources through the live wire's projection", async () => {
    const messages = await replay([assistant({ sources: [SOURCE] })])

    expect(messages[0].sources).toStrictEqual([SOURCE])
  })

  it("parses a payload carrying NEITHER field (the pre-feat-329 shape)", async () => {
    const messages = await replay([assistant()])

    expect(messages[0].video).toBeUndefined()
    expect(messages[0].sources).toBeUndefined()
    expect(messages[0].text).toBe("Here is one.")
  })

  it("degrades a malformed video to absent — never a failed replay", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const messages = await replay([
      assistant({ video: { ...VIDEO, playbackId: "no" } }),
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].text).toBe("Here is one.")
    expect(messages[0].video).toBeUndefined()
  })

  it("rejects a replayed slug that would escape the watch path", async () => {
    // The slug gate is the SOLE control over the raw-interpolated path; a
    // stored row is no more trusted than a live one.
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const messages = await replay([
      assistant({ video: { ...VIDEO, slug: "../../evil?x=1" } }),
    ])

    expect(messages[0].video).toBeUndefined()
  })

  it("ignores a watchUrl on the replay wire", async () => {
    const messages = await replay([
      assistant({
        video: { ...VIDEO, watchUrl: "https://evil.example.com/pwn" },
      }),
    ])

    expect(messages[0].video?.watchUrl).toBe(
      "https://www.jesusfilm.org/watch/jesus-calms-the-storm.html",
    )
  })

  it("drops malformed sources individually, keeping the well-shaped ones", async () => {
    const messages = await replay([
      assistant({ sources: [SOURCE, { sourceName: 42 }, null] }),
    ])

    expect(messages[0].sources).toStrictEqual([SOURCE])
  })

  it("AGGREGATES the video diagnostic — one line per replay, not per message", async () => {
    // Rejections are seeded in REVERSE alphabetical order (slug before
    // playback_id) so the emitted line can only be sorted if the sort actually
    // runs — insertion order alone would spell it the other way round.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await replay([
      assistant({ id: "m1", video: { ...VIDEO, slug: "BAD" } }),
      assistant({ id: "m2", video: { ...VIDEO, playbackId: "no" } }),
      assistant({ id: "m3", video: { ...VIDEO, playbackId: "no" } }),
    ])

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      "[chat-video] event=replay_projection_rejected playback_id=2 slug=1",
    )
  })

  it("stays silent when no replayed turn declared a video", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await replay([assistant(), assistant({ id: "m2", sources: [SOURCE] })])

    expect(warn).not.toHaveBeenCalled()
  })

  it("logs no wire VALUE — only reason tokens and counts", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await replay([
      assistant({
        video: { ...VIDEO, title: "", playbackId: "SECRET-TITLE-LEAK" },
      }),
    ])

    const line = warn.mock.calls[0]?.[0] as string
    expect(line).not.toContain("SECRET-TITLE-LEAK")
    expect(line).not.toContain("Jesus calms the storm")
  })

  it("still drops an empty-text message, attachments or not", async () => {
    // The empty-text drop is unchanged (feat-329): the server attaches to the
    // turn's text-bearing message, so nothing rides a dropped tool-only step.
    const messages = await replay([
      assistant({ id: "m1", text: "   ", video: VIDEO }),
      assistant({ id: "m2" }),
    ])

    expect(messages.map((m) => m.id)).toEqual(["m2"])
  })
})
