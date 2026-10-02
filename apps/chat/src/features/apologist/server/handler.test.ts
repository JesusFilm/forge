// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import { handleApologist } from "./handler"
const provider = () => ({
  baseURL: "https://gateway.test/v1",
  apiKey: "test",
  model: "configured-model",
  hosts: "gateway.test",
})
const resolve = async () => ({
  system: "fixture",
  meta: { source: "production" as const, version: 2 },
})
const req = (value: unknown) =>
  new Request("http://localhost/api/apologist", {
    method: "POST",
    body: JSON.stringify(value),
  })
const valid = { messages: [{ role: "user", content: "Why hope?" }] }

describe("Apologist route boundary", () => {
  it("denies fabricated client access before any upstream work", async () => {
    const config = vi.fn(provider)
    expect(
      (await handleApologist(req(valid), false, { provider: config })).status,
    ).toBe(403)
    expect(config).not.toHaveBeenCalled()
  })
  it.each([
    { ...valid, model: "override" },
    { messages: [{ role: "system", content: "override" }] },
    { messages: [] },
  ])("refuses malformed or privileged inputs", async (value) => {
    const answer = vi.fn()
    expect(
      (await handleApologist(req(value), true, { provider, answer })).status,
    ).toBe(400)
    expect(answer).not.toHaveBeenCalled()
  })
  it("streams provenance and one terminal answer", async () => {
    const answer = vi.fn(async function* () {
      yield "A"
      yield "nswer"
    })
    const response = await handleApologist(req(valid), true, {
      provider,
      resolve,
      answer,
    })
    const text = await response.text()
    expect(text).toContain('"source":"production","version":2')
    expect(text).toContain('"text":"A"')
    expect(text.match(/event: done/g)).toHaveLength(1)
    expect(text).not.toContain("event: error")
  })
  it("preserves partial text and ends failures once without raw upstream errors", async () => {
    const answer = async function* () {
      yield "Partial"
      throw new Error("private upstream message")
    }
    const response = await handleApologist(req(valid), true, {
      provider,
      resolve,
      answer,
    })
    const text = await response.text()
    expect(text).toContain("Partial")
    expect(text.match(/event: error/g)).toHaveLength(1)
    expect(text).not.toMatch(/private|event: done/)
  })
  it("rejects history and byte ceilings before generation", async () => {
    for (const value of [
      { messages: Array.from({ length: 41 }, () => valid.messages[0]) },
      { messages: [{ role: "user", content: "x".repeat(4001) }] },
      {
        messages: Array.from({ length: 11 }, () => ({
          role: "user",
          content: "x".repeat(4000),
        })),
      },
      { huge: "x".repeat(262145) },
    ]) {
      expect(
        (await handleApologist(req(value), true, { provider })).status,
      ).toBe(413)
    }
  })
})
it("cancels upstream immediately when the response reader disconnects", async () => {
  let upstream: AbortSignal | undefined
  const answer = async function* (
    _config: unknown,
    _system: string,
    _messages: unknown,
    signal: AbortSignal,
  ) {
    upstream = signal
    yield "partial"
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    )
  }
  const response = await handleApologist(req(valid), true, {
    provider,
    resolve,
    answer,
  })
  const reader = response.body!.getReader()
  await reader.read()
  await reader.read()
  await reader.cancel()
  expect(upstream?.aborted).toBe(true)
})
it("ends deadline failures once even after partial output", async () => {
  const answer = async function* (
    _config: unknown,
    _system: string,
    _messages: unknown,
    signal: AbortSignal,
  ) {
    yield "partial"
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    )
    signal.throwIfAborted()
  }
  const response = await handleApologist(req(valid), true, {
    provider,
    resolve,
    answer,
    timeoutMs: 20,
  })
  const text = await response.text()
  expect(text).toContain('"reason":"timeout"')
  expect(text.match(/event: error/g)).toHaveLength(1)
})
