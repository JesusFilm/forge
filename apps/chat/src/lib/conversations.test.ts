import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import {
  CONVERSATION_TITLE_MAX_UNITS,
  createConversation,
  deriveTitle,
  fallbackTitle,
  NEW_CONVERSATION_TITLE,
  normalizeConversationTitle,
  TITLE_STRIP_PATTERN,
  titleFromFirstUser,
} from "./conversations"

describe("createConversation", () => {
  it("starts empty with the default title and a unique id", () => {
    const a = createConversation()
    const b = createConversation()

    expect(a.title).toBe(NEW_CONVERSATION_TITLE)
    expect(a.messages).toEqual([])
    expect(a.id).not.toBe(b.id)
  })
})

describe("deriveTitle", () => {
  it("returns a short message unchanged", () => {
    expect(deriveTitle("Is doubt a sin?")).toBe("Is doubt a sin?")
  })

  it("trims surrounding whitespace and collapses internal runs", () => {
    expect(deriveTitle("  hello   there  \n friend ")).toBe(
      "hello there friend",
    )
  })

  it("keeps a 40-character title whole (boundary)", () => {
    const exactly40 = "a".repeat(40)
    expect(deriveTitle(exactly40)).toBe(exactly40)
  })

  it("truncates a 41-character title to 39 chars + ellipsis", () => {
    const result = deriveTitle("a".repeat(41))
    expect(result).toBe(`${"a".repeat(39)}…`)
    expect(result).toHaveLength(40)
  })

  it("truncates a very long unbroken string to the 40-char ceiling", () => {
    const result = deriveTitle("x".repeat(200))
    expect(result).toBe(`${"x".repeat(39)}…`)
    expect(result).toHaveLength(40)
  })

  it("does not leave a trailing space before the ellipsis", () => {
    // Index 38 (the char the 39-char slice ends on) is a space, so trimEnd
    // must drop it before the ellipsis is appended.
    const text = `${"a".repeat(38)} ${"b".repeat(10)}`
    const result = deriveTitle(text)
    expect(result).toBe(`${"a".repeat(38)}…`)
    expect(result).not.toContain(" …")
  })
})

describe("fallbackTitle (feat-241, R11/AE6)", () => {
  it("derives a date label from the last-activity timestamp", () => {
    const title = fallbackTitle("2026-07-10T08:00:00.000Z")
    expect(title).toMatch(/^Conversation — /)
    // The label carries a real date fragment (month rendered per locale).
    expect(title.length).toBeGreaterThan("Conversation — ".length)
  })

  it("yields distinguishable labels for threads with different activity dates", () => {
    const a = fallbackTitle("2026-07-10T12:00:00.000Z")
    const b = fallbackTitle("2026-06-02T12:00:00.000Z")
    expect(a).not.toBe(b)
  })

  it("is deterministic for the same input", () => {
    expect(fallbackTitle("2026-07-10T08:00:00.000Z")).toBe(
      fallbackTitle("2026-07-10T08:00:00.000Z"),
    )
  })

  it("degrades to the bare noun for empty or unparseable input", () => {
    expect(fallbackTitle("")).toBe("Conversation")
    expect(fallbackTitle("not-a-date")).toBe("Conversation")
  })
})

describe("titleFromFirstUser (feat-270)", () => {
  it("backfills a blank or whitespace-only title from the first user turn", () => {
    expect(titleFromFirstUser("", "Is doubt a sin?")).toBe(
      deriveTitle("Is doubt a sin?"),
    )
    expect(titleFromFirstUser("   ", "Is doubt a sin?")).toBe(
      deriveTitle("Is doubt a sin?"),
    )
  })

  it("never displaces a non-empty title", () => {
    expect(titleFromFirstUser("LLM Title", "hello there")).toBe("LLM Title")
  })

  it("keeps the blank title when no user turn exists (date fallback stays)", () => {
    expect(titleFromFirstUser("", undefined)).toBe("")
  })
})

describe("normalizeConversationTitle (feat-450, KTD6)", () => {
  it("trims and collapses whitespace runs, keeping visible text byte-identical", () => {
    expect(normalizeConversationTitle("  Faith   and\n doubt ")).toBe(
      "Faith and doubt",
    )
    expect(normalizeConversationTitle("Faith and doubt")).toBe(
      "Faith and doubt",
    )
  })

  it("strips control and invisible-format characters, so an invisible-only draft normalizes to empty (AE2/R6)", () => {
    expect(normalizeConversationTitle("\u200b\u200d\ufeff\u00ad")).toBe("")
    expect(normalizeConversationTitle("\u0007\u001f\u007f\u009f")).toBe("")
    expect(normalizeConversationTitle("Fa\u200bith\u202e and")).toBe(
      "Fa ith and",
    )
  })

  it("does not clamp — the server's clamp is the authority and its echo is adopted", () => {
    const long = "x".repeat(CONVERSATION_TITLE_MAX_UNITS + 10)
    expect(normalizeConversationTitle(long)).toBe(long)
    expect(CONVERSATION_TITLE_MAX_UNITS).toBe(120)
  })

  // Mirror pin (apps cannot cross-import): read the Mastra clamp's SOURCE and
  // compare the regex literal byte-for-byte, so drift on either side goes red
  // — the precedent is mastra's byte-cap pin against history-proxy.ts.
  it("mirrors the Mastra clamp's character class byte-for-byte", () => {
    // process.cwd() is apps/chat under vitest (the module-contract pin in
    // conversation-session.test.ts relies on the same fact).
    const mastraClamp = readFileSync(
      resolve(process.cwd(), "../mastra/src/mastra/ai-chat-title-clamp.ts"),
      "utf8",
    )
    const declared = mastraClamp.match(/\n\s*\/(\[[^\n]*?\])\/g,\n/)
    expect(declared).not.toBeNull()
    expect(TITLE_STRIP_PATTERN.source).toBe(declared![1])
    expect(TITLE_STRIP_PATTERN.flags).toBe("g")
    // And the mirrored bound is Mastra's AI_CHAT_TITLE_MAX_UNITS.
    const bound = mastraClamp.match(/AI_CHAT_TITLE_MAX_UNITS = (\d+)/)
    expect(Number(bound![1])).toBe(CONVERSATION_TITLE_MAX_UNITS)
  })
})
