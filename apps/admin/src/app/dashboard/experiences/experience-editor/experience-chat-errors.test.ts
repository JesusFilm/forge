import { describe, expect, it } from "vitest"

import type { ChatErrorCode } from "@/services/experience-ai/experience-ai-chat.service"

import {
  CHAT_ERROR_PRESENTATION,
  presentChatError,
} from "./experience-chat-errors"

const ALL_CODES: ReadonlyArray<ChatErrorCode> = [
  "codex_unavailable",
  "codex_timeout",
  "codex_idle_timeout",
  "invalid_json",
  "schema_violation",
  "slug_change_rejected",
  "cross_locale_unconfirmed",
  "rate_limited",
  "forbidden",
  "locale_not_found",
  "thread_not_found",
  "cancelled",
  "empty_response",
  "unknown",
]

const WARN_CODES: ReadonlySet<ChatErrorCode> = new Set([
  "cancelled",
  "slug_change_rejected",
  "cross_locale_unconfirmed",
])

const RETRY_CODES: ReadonlySet<ChatErrorCode> = new Set([
  "codex_unavailable",
  "codex_timeout",
  "codex_idle_timeout",
  "invalid_json",
  "schema_violation",
  "rate_limited",
  "empty_response",
  "unknown",
])

describe("CHAT_ERROR_PRESENTATION", () => {
  it("has an entry for every ChatErrorCode and no extras", () => {
    const keys = Object.keys(CHAT_ERROR_PRESENTATION)
    expect(keys.length).toBe(ALL_CODES.length)
    for (const code of ALL_CODES) {
      expect(keys).toContain(code)
    }
  })

  it("assigns severity 'warn' to user-initiated/expected codes and 'error' to the rest", () => {
    for (const code of ALL_CODES) {
      const expected = WARN_CODES.has(code) ? "warn" : "error"
      expect(CHAT_ERROR_PRESENTATION[code].severity).toBe(expected)
    }
  })

  it("assigns retry=true to recoverable codes and retry=false to terminal/boundary codes", () => {
    for (const code of ALL_CODES) {
      const expected = RETRY_CODES.has(code)
      expect(CHAT_ERROR_PRESENTATION[code].retry).toBe(expected)
    }
  })

  it("has a non-empty title (≤ 30 chars) for every entry", () => {
    for (const code of ALL_CODES) {
      const { title } = CHAT_ERROR_PRESENTATION[code]
      expect(title.length).toBeGreaterThan(0)
      expect(title.length).toBeLessThanOrEqual(30)
    }
  })

  it("has a non-empty message (≤ 200 chars) for every entry", () => {
    for (const code of ALL_CODES) {
      const { message } = CHAT_ERROR_PRESENTATION[code]
      expect(message.length).toBeGreaterThan(0)
      expect(message.length).toBeLessThanOrEqual(200)
    }
  })
})

describe("presentChatError", () => {
  it("returns the unknown entry for the 'unknown' code", () => {
    expect(presentChatError("unknown")).toBe(CHAT_ERROR_PRESENTATION.unknown)
  })

  it("falls back to the unknown entry for unrecognized codes rather than throwing", () => {
    expect(() => presentChatError("not_a_real_code")).not.toThrow()
    expect(presentChatError("not_a_real_code")).toBe(
      CHAT_ERROR_PRESENTATION.unknown,
    )
  })
})
