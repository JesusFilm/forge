import { describe, expect, it } from "vitest"

import { buildStubReply, STUB_REPLY_DELAY_MS } from "./chat-stub"

describe("buildStubReply", () => {
  it("identifies itself as stubbed and echoes the user text", () => {
    const reply = buildStubReply("hello")
    expect(reply).toContain("Stubbed reply")
    expect(reply).toContain("no agent is connected")
    expect(reply).toContain("hello")
  })

  it("embeds quotes and newlines verbatim", () => {
    const text = 'line one\nline two with "quotes"'
    expect(buildStubReply(text)).toContain(text)
  })
})

describe("STUB_REPLY_DELAY_MS", () => {
  it("is a positive finite number", () => {
    expect(Number.isFinite(STUB_REPLY_DELAY_MS)).toBe(true)
    expect(STUB_REPLY_DELAY_MS).toBeGreaterThan(0)
  })
})
