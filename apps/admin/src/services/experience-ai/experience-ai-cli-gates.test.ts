import { beforeEach, describe, expect, it, vi } from "vitest"

const { envState } = vi.hoisted(() => ({
  envState: {
    EXPERIENCE_AI_ALLOW_CODEX: undefined as boolean | undefined,
    EXPERIENCE_AI_ALLOW_CODEX_FALLBACK: undefined as boolean | undefined,
    EXPERIENCE_AI_ALLOW_CLAUDE_CODE: undefined as boolean | undefined,
  },
}))

vi.mock("@/config/env", () => ({ env: envState }))

import {
  __resetCliGatesForTest,
  isClaudeCodeAllowed,
  isCodexAllowed,
} from "./experience-ai-cli-gates"

describe("isCodexAllowed", () => {
  beforeEach(() => {
    envState.EXPERIENCE_AI_ALLOW_CODEX = undefined
    envState.EXPERIENCE_AI_ALLOW_CODEX_FALLBACK = undefined
    __resetCliGatesForTest()
  })

  it("returns true when new var is true; emits no deprecation log", () => {
    envState.EXPERIENCE_AI_ALLOW_CODEX = true
    const warn = vi.fn()
    expect(isCodexAllowed({ warn })).toBe(true)
    expect(warn).not.toHaveBeenCalled()
  })

  it("returns false when new var is explicitly false (legacy ignored)", () => {
    envState.EXPERIENCE_AI_ALLOW_CODEX = false
    envState.EXPERIENCE_AI_ALLOW_CODEX_FALLBACK = true
    const warn = vi.fn()
    expect(isCodexAllowed({ warn })).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it("falls back to legacy var when new var is unset; emits deprecation log", () => {
    envState.EXPERIENCE_AI_ALLOW_CODEX_FALLBACK = true
    const warn = vi.fn()
    expect(isCodexAllowed({ warn })).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain(
      "EXPERIENCE_AI_ALLOW_CODEX_FALLBACK",
    )
    expect(warn.mock.calls[0]![0]).toContain("EXPERIENCE_AI_ALLOW_CODEX")
  })

  it("fires the deprecation log at most once across multiple calls", () => {
    envState.EXPERIENCE_AI_ALLOW_CODEX_FALLBACK = true
    const warn = vi.fn()
    isCodexAllowed({ warn })
    isCodexAllowed({ warn })
    isCodexAllowed({ warn })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("returns false when both vars are unset; emits no log", () => {
    const warn = vi.fn()
    expect(isCodexAllowed({ warn })).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it("returns false when legacy var is explicitly false", () => {
    envState.EXPERIENCE_AI_ALLOW_CODEX_FALLBACK = false
    const warn = vi.fn()
    expect(isCodexAllowed({ warn })).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })
})

describe("isClaudeCodeAllowed", () => {
  beforeEach(() => {
    envState.EXPERIENCE_AI_ALLOW_CLAUDE_CODE = undefined
  })

  it("returns true when the var is true", () => {
    envState.EXPERIENCE_AI_ALLOW_CLAUDE_CODE = true
    expect(isClaudeCodeAllowed()).toBe(true)
  })

  it("returns false when unset", () => {
    expect(isClaudeCodeAllowed()).toBe(false)
  })

  it("returns false when explicitly false", () => {
    envState.EXPERIENCE_AI_ALLOW_CLAUDE_CODE = false
    expect(isClaudeCodeAllowed()).toBe(false)
  })
})
