import { describe, expect, it, vi } from "vitest"

import {
  DEFAULT_CHAT_PROVIDER,
  normalizeChatProvider,
} from "./experience-ai-chat-provider"

describe("normalizeChatProvider", () => {
  it("returns the matched literal for known values", () => {
    expect(normalizeChatProvider("openrouter")).toBe("openrouter")
    expect(normalizeChatProvider("ollama")).toBe("ollama")
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
