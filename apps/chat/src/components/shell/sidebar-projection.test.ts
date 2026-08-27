// Pure-function coverage for the sidebar's visible-row projection (Ruling
// 4b) — the describe moved verbatim from lib/use-conversations.test.ts when
// listConversations relocated here (feat-281 PR 2).
import { describe, expect, it } from "vitest"

import { type Conversation } from "@/lib/conversations"

import { listConversations } from "./sidebar-projection"

function conversation(
  over: Partial<Conversation> & { id: string },
): Conversation {
  return { title: "New conversation", messages: [], ...over }
}

describe("listConversations (feat-270, feat-401)", () => {
  it("hides never-used empty local conversations that are not active", () => {
    const rows = listConversations(
      [
        conversation({ id: "stale-empty" }),
        conversation({
          id: "titled",
          messages: [{ id: "m", role: "user", content: "x" }],
          lastActivityAt: "2026-07-10T08:00:00.000Z",
        }),
      ],
      "titled",
    )
    expect(rows.map((c) => c.id)).toEqual(["titled"])
  })

  // feat-401 inverts this case: the ACTIVE empty local row used to be pinned
  // on top; an unstarted conversation now gets no row at all.
  it("hides the ACTIVE empty local conversation — unstarted means no row", () => {
    const rows = listConversations(
      [
        conversation({
          id: "titled",
          messages: [{ id: "m", role: "user", content: "x" }],
          lastActivityAt: "2026-07-10T08:00:00.000Z",
        }),
        conversation({ id: "fresh" }),
      ],
      "fresh",
    )
    expect(rows.map((c) => c.id)).toEqual(["titled"])
  })

  // Fixture unchanged from feat-270 (the empty LOCAL row "fresh" is still
  // ACTIVE); only the expectation is re-cut. That row is what proves the
  // surviving clause is `origin === "server"`, not "anything empty".
  it("keeps empty SERVER rows even when inactive — they are history, not clutter", () => {
    const rows = listConversations(
      [
        conversation({ id: "fresh" }),
        conversation({
          id: "server-row",
          origin: "server",
          replay: "idle",
          lastActivityAt: "2026-07-12T08:00:00.000Z",
        }),
      ],
      "fresh",
    )
    expect(rows.map((c) => c.id)).toEqual(["server-row"])
  })

  // The server-clause guard (feat-401 / feat-209 R3): an adopted deep-link
  // row is server-origin, ZERO messages, and ACTIVE while its replay runs —
  // the shape the dropped disjunct carried. Dropping the clause hides it.
  it("keeps the ACTIVE empty SERVER row — an adopted deep link awaiting replay", () => {
    const rows = listConversations(
      [
        conversation({
          id: "titled",
          messages: [{ id: "m", role: "user", content: "x" }],
          lastActivityAt: "2026-07-10T08:00:00.000Z",
        }),
        conversation({
          id: "adopted",
          title: "",
          origin: "server",
          serverPersisted: true,
          replay: "loading",
        }),
      ],
      "adopted",
    )
    // Pinned first by orderConversations' feat-209 R3 branch (an ACTIVE
    // server row with no lastActivityAt yet), and kept by the server clause.
    expect(rows.map((c) => c.id)).toEqual(["adopted", "titled"])
  })
})
