import { describe, expect, it } from "vitest"

import {
  describeFetchError,
  isClientTimeout,
  postViaNode,
  resolveTimeoutMs,
} from "./mastra-http-transport"

describe("resolveTimeoutMs", () => {
  it("accepts valid numbers and numeric strings", () => {
    expect(resolveTimeoutMs(90_000, 1)).toBe(90_000)
    expect(resolveTimeoutMs("90000", 1)).toBe(90_000)
  })

  it("falls back on undefined, zero, negative, NaN, and junk strings", () => {
    expect(resolveTimeoutMs(undefined, 123)).toBe(123)
    expect(resolveTimeoutMs(0, 123)).toBe(123)
    expect(resolveTimeoutMs(-5, 123)).toBe(123)
    expect(resolveTimeoutMs(Number.NaN, 123)).toBe(123)
    expect(resolveTimeoutMs("not-a-number", 123)).toBe(123)
  })
})

describe("isClientTimeout", () => {
  it("recognizes node TimeoutError and fetch AbortError by name", () => {
    expect(
      isClientTimeout(Object.assign(new Error("x"), { name: "TimeoutError" })),
    ).toBe(true)
    expect(
      isClientTimeout(Object.assign(new Error("x"), { name: "AbortError" })),
    ).toBe(true)
  })

  it("rejects other errors and non-errors", () => {
    expect(isClientTimeout(new Error("ECONNRESET"))).toBe(false)
    expect(isClientTimeout("TimeoutError")).toBe(false)
    expect(isClientTimeout(undefined)).toBe(false)
  })
})

describe("describeFetchError", () => {
  it("renders name, code, cause, and message as a plain string", () => {
    const cause = Object.assign(new Error("refused"), {
      code: "ECONNREFUSED",
    })
    const error = new Error("fetch failed", { cause })
    const described = describeFetchError(error)
    expect(described).toContain("name=Error")
    expect(described).toContain("code=ECONNREFUSED")
    expect(described).toContain("cause=Error")
    expect(described).toContain("message=fetch failed")
    // Railway logsV2 law: plain string, never JSON.
    expect(described.startsWith("{")).toBe(false)
  })
})

describe("postViaNode wall-clock deadline", () => {
  it("bounds a trickling response that never goes idle (wall-clock, not idle timeout)", async () => {
    // A slow-drip upstream sends a byte well inside any idle window forever.
    // `req.setTimeout` alone never fires for this shape — only the wall-clock
    // deadline bounds it. This is the regression guard for the
    // 90s-under-Cloudflare invariant on the MCP generate path.
    const { createServer } = await import("node:http")
    const server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" })
      const drip = setInterval(() => {
        res.write("x")
      }, 40)
      res.on("close", () => clearInterval(drip))
    })
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const address = server.address()
    if (address == null || typeof address === "string") {
      throw new Error("expected a TCP address")
    }

    try {
      const started = Date.now()
      await expect(
        postViaNode(
          new URL(`http://127.0.0.1:${address.port}/drip`),
          { "content-type": "application/json" },
          "{}",
          400,
          { timeoutErrorMessage: "trickle test timed out" },
        ),
      ).rejects.toMatchObject({ name: "TimeoutError" })
      // Bounded by the wall clock (with slack), not by the endless drip.
      expect(Date.now() - started).toBeLessThan(5_000)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
