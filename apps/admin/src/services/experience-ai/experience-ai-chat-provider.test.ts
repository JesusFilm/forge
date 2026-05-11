import { describe, expect, it, vi } from "vitest"

import {
  DEFAULT_CHAT_PROVIDER,
  normalizeChatProvider,
} from "./experience-ai-chat-provider"

describe("normalizeChatProvider", () => {
  it("returns the matched literal for known values", () => {
    expect(normalizeChatProvider("openrouter")).toBe("openrouter")
    expect(normalizeChatProvider("ollama")).toBe("ollama")
    expect(normalizeChatProvider("codex")).toBe("codex")
    expect(normalizeChatProvider("claude-code")).toBe("claude-code")
  })

  it("accepts underscore variant for claude-code", () => {
    expect(normalizeChatProvider("claude_code")).toBe("claude-code")
    expect(normalizeChatProvider("CLAUDE_CODE")).toBe("claude-code")
  })

  it("returns the default when input is undefined or null", () => {
    expect(normalizeChatProvider(undefined)).toBe(DEFAULT_CHAT_PROVIDER)
    expect(normalizeChatProvider(null)).toBe(DEFAULT_CHAT_PROVIDER)
  })

  it("returns the default when input is not a string", () => {
    expect(normalizeChatProvider(42)).toBe(DEFAULT_CHAT_PROVIDER)
    expect(normalizeChatProvider({})).toBe(DEFAULT_CHAT_PROVIDER)
    expect(normalizeChatProvider([])).toBe(DEFAULT_CHAT_PROVIDER)
  })

  it("is case-insensitive and trims whitespace", () => {
    expect(normalizeChatProvider("OLLAMA")).toBe("ollama")
    expect(normalizeChatProvider("   ollama  ")).toBe("ollama")
    expect(normalizeChatProvider("OpenRouter")).toBe("openrouter")
    expect(normalizeChatProvider("  Claude-Code  ")).toBe("claude-code")
  })

  it("rejects close-but-wrong values to surface typos (claude alone)", () => {
    // `claude` without the `-code` suffix is ambiguous — could mean the API
    // (not in scope) or be a typo for `claude-code`. Bias toward making
    // the editor notice the typo rather than silently substituting.
    const warn = vi.fn()
    expect(normalizeChatProvider("claude", { warn })).toBe(
      DEFAULT_CHAT_PROVIDER,
    )
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("returns the default for an empty string", () => {
    expect(normalizeChatProvider("")).toBe(DEFAULT_CHAT_PROVIDER)
    expect(normalizeChatProvider("   ")).toBe(DEFAULT_CHAT_PROVIDER)
  })

  it("falls back to default for unknown values and emits a sanitized log", () => {
    const warn = vi.fn()
    const result = normalizeChatProvider("gpt5", { warn })
    expect(result).toBe(DEFAULT_CHAT_PROVIDER)
    expect(warn).toHaveBeenCalledTimes(1)
    const [message] = warn.mock.calls[0]!
    expect(message).toContain("event=unknown_chat_provider")
    expect(message).toContain("value=gpt5")
  })

  it("strips CR/LF/TAB before matching (log-injection guard)", () => {
    const warn = vi.fn()
    const result = normalizeChatProvider("oll\nama", { warn })
    // The newline is stripped, so "ollama" matches.
    expect(result).toBe("ollama")
    expect(warn).not.toHaveBeenCalled()
  })

  it("clamps long unknown values in the log to 64 chars", () => {
    const warn = vi.fn()
    const long = "x".repeat(200)
    normalizeChatProvider(long, { warn })
    expect(warn).toHaveBeenCalledTimes(1)
    const [, meta] = warn.mock.calls[0]!
    expect((meta as { value: string }).value.length).toBe(64)
  })

  it("does not throw when called without a logger", () => {
    expect(() => normalizeChatProvider("garbage")).not.toThrow()
    expect(normalizeChatProvider("garbage")).toBe(DEFAULT_CHAT_PROVIDER)
  })
})
