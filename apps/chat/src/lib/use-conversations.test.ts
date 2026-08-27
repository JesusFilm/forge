// Pure-function coverage for the session's merge/order helpers (behavioral
// flows live in app-shell.test.tsx); pins invariants the UI cannot arrange
// directly. listConversations moved to shell/sidebar-projection.test.ts (4b).
import { describe, expect, it } from "vitest"

import {
  mergeReplayMessages,
  mergeServerThreads,
  orderConversations,
} from "./conversation-session"
import { type Conversation, type Message } from "./conversations"

function conversation(
  over: Partial<Conversation> & { id: string },
): Conversation {
  return { title: "New conversation", messages: [], ...over }
}

describe("mergeServerThreads (KTD9)", () => {
  it("appends unknown rows as message-less server-origin conversations with replay idle", () => {
    const merged = mergeServerThreads(
      [conversation({ id: "local" })],
      [
        {
          id: "s1",
          title: "Server row",
          updatedAt: "2026-07-12T08:00:00.000Z",
        },
      ],
    )
    expect(merged).toHaveLength(2)
    expect(merged[1]).toEqual({
      id: "s1",
      title: "Server row",
      messages: [],
      origin: "server",
      serverPersisted: true,
      lastActivityAt: "2026-07-12T08:00:00.000Z",
      replay: "idle",
    })
  })

  it("keeps in-session messages authoritative and marks the conversation persisted", () => {
    const messages: Message[] = [{ id: "m1", role: "user", content: "hi" }]
    const merged = mergeServerThreads(
      [conversation({ id: "c1", title: "hi", messages })],
      [{ id: "c1", title: "", updatedAt: "2026-07-12T08:00:00.000Z" }],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]!.messages).toBe(messages)
    expect(merged[0]!.serverPersisted).toBe(true)
    // Origin stays local — the conversation has its own in-session transcript.
    expect(merged[0]!.origin).toBeUndefined()
  })

  it("lets a non-empty server title win and keeps the client title otherwise", () => {
    const prev = [conversation({ id: "c1", title: "client snippet" })]
    const titled = mergeServerThreads(prev, [
      { id: "c1", title: "LLM Title", updatedAt: "2026-07-12T08:00:00.000Z" },
    ])
    expect(titled[0]!.title).toBe("LLM Title")
    const untitled = mergeServerThreads(prev, [
      { id: "c1", title: "  ", updatedAt: "2026-07-12T08:00:00.000Z" },
    ])
    expect(untitled[0]!.title).toBe("client snippet")
  })

  it("dedupes across pages: a re-listed row keeps its first-seen position", () => {
    const pageOne = mergeServerThreads(
      [],
      [
        { id: "a", title: "A", updatedAt: "2026-07-12T08:00:00.000Z" },
        { id: "b", title: "B", updatedAt: "2026-07-11T08:00:00.000Z" },
      ],
    )
    const pageTwo = mergeServerThreads(pageOne, [
      { id: "b", title: "B", updatedAt: "2026-07-11T08:00:00.000Z" },
      { id: "c", title: "C", updatedAt: "2026-07-10T08:00:00.000Z" },
    ])
    expect(pageTwo.map((c) => c.id)).toEqual(["a", "b", "c"])
  })

  it("keeps an existing local activity stamp over the listed updatedAt", () => {
    const merged = mergeServerThreads(
      [conversation({ id: "c1", lastActivityAt: "2026-07-13T10:00:00.000Z" })],
      [{ id: "c1", title: "", updatedAt: "2026-07-12T08:00:00.000Z" }],
    )
    expect(merged[0]!.lastActivityAt).toBe("2026-07-13T10:00:00.000Z")
  })
})

describe("mergeReplayMessages (KTD11/KTD5)", () => {
  it("prepends unknown transcript turns and preserves existing message objects by identity", () => {
    const streaming: Message = { id: "live", role: "assistant", content: "par" }
    const merged = mergeReplayMessages(
      [
        { id: "t1", role: "user", text: "old q", createdAt: "" },
        { id: "live", role: "assistant", text: "stale copy", createdAt: "" },
      ],
      [streaming],
    )
    // The in-flight turn is the SAME object (patches keep landing), and the
    // stale server copy of it was dropped, not merged.
    expect(merged).toHaveLength(2)
    expect(merged[1]).toBe(streaming)
    expect(merged[0]).toEqual({ id: "t1", role: "user", content: "old q" })
  })

  it("maps an attachment-less replayed turn to bare text — no engine/grounded", () => {
    const [message] = mergeReplayMessages(
      [{ id: "t1", role: "assistant", text: "answer", createdAt: "x" }],
      [],
    )
    expect(message).toEqual({ id: "t1", role: "assistant", content: "answer" })
    expect(Object.keys(message!)).toEqual(["id", "role", "content"])
  })

  it("carries feat-329 attachments through while still stripping the badges", () => {
    // R21 is BADGE stripping, not attachment stripping: the player and the
    // sources return on reload, the engine/grounded tags do not.
    const [message] = mergeReplayMessages(
      [
        {
          id: "t1",
          role: "assistant",
          text: "answer",
          createdAt: "x",
          sources: [
            {
              sourceName: "S",
              title: null,
              url: "https://example.org/a",
              score: 1,
              snippet: "p",
            },
          ],
          video: {
            videoId: "v1",
            title: "T",
            playbackId: "abcdEFGH1234",
            durationSeconds: 10,
            watchUrl: "https://www.jesusfilm.org/watch/t.html",
          },
        },
      ],
      [],
    )
    expect(message!.sources).toHaveLength(1)
    expect(message!.video?.videoId).toBe("v1")
    expect(Object.keys(message!)).toEqual([
      "id",
      "role",
      "content",
      "sources",
      "video",
    ])
    expect(message!.engine).toBeUndefined()
    expect(message!.grounded).toBeUndefined()
  })
})

// feat-401: the fresh-empty-LOCAL pin below no longer reaches the RAIL —
// listConversations filters every local empty out. These stay as the ordering
// primitive's own contract; do not read them as live sidebar policy.
describe("orderConversations (KTD9)", () => {
  it("pins fresh empty local conversations on top, then activity-descending", () => {
    const ordered = orderConversations(
      [
        conversation({
          id: "old-local",
          messages: [{ id: "m", role: "user", content: "x" }],
          lastActivityAt: "2026-07-10T08:00:00.000Z",
        }),
        conversation({ id: "fresh" }),
        conversation({
          id: "server-new",
          origin: "server",
          replay: "idle",
          lastActivityAt: "2026-07-12T08:00:00.000Z",
        }),
      ],
      "fresh",
    )
    expect(ordered.map((c) => c.id)).toEqual([
      "fresh",
      "server-new",
      "old-local",
    ])
  })

  it("does not pin empty SERVER rows (they are history, not a fresh pane)", () => {
    const ordered = orderConversations(
      [
        conversation({
          id: "server-row",
          origin: "server",
          replay: "idle",
          lastActivityAt: "2026-07-12T08:00:00.000Z",
        }),
        conversation({ id: "fresh" }),
      ],
      "fresh",
    )
    expect(ordered.map((c) => c.id)).toEqual(["fresh", "server-row"])
  })

  it("keeps first-seen order for equal/missing activity keys (stable sort)", () => {
    const ordered = orderConversations(
      [
        conversation({
          id: "a",
          origin: "server",
          replay: "idle",
          lastActivityAt: "2026-07-12T08:00:00.000Z",
        }),
        conversation({
          id: "b",
          origin: "server",
          replay: "idle",
          lastActivityAt: "2026-07-12T08:00:00.000Z",
        }),
      ],
      "a",
    )
    expect(ordered.map((c) => c.id)).toEqual(["a", "b"])
  })

  it("pins an ACTIVE lastActivityAt-less server row with the fresh pins (feat-209 R3)", () => {
    const ordered = orderConversations(
      [
        conversation({
          id: "hydrated",
          origin: "server",
          replay: "idle",
          lastActivityAt: "2026-07-12T08:00:00.000Z",
        }),
        conversation({ id: "adopted", origin: "server", replay: "loading" }),
      ],
      "adopted",
    )
    expect(ordered.map((c) => c.id)).toEqual(["adopted", "hydrated"])
  })

  it("stops pinning the same server row once deselected — it falls to last", () => {
    const ordered = orderConversations(
      [
        conversation({ id: "adopted", origin: "server", replay: "loading" }),
        conversation({
          id: "hydrated",
          origin: "server",
          replay: "idle",
          lastActivityAt: "2026-07-12T08:00:00.000Z",
        }),
      ],
      "hydrated",
    )
    expect(ordered.map((c) => c.id)).toEqual(["hydrated", "adopted"])
  })
})
