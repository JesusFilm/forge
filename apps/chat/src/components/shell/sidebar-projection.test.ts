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

describe("listConversations (feat-270)", () => {
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

  it("keeps the ACTIVE empty local conversation pinned on top", () => {
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
    expect(rows.map((c) => c.id)).toEqual(["fresh", "titled"])
  })

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
    expect(rows.map((c) => c.id)).toEqual(["fresh", "server-row"])
  })
})
