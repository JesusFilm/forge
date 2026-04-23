import { afterEach, describe, expect, it, vi } from "vitest"

// Capture the redirect target; the real implementation throws a sentinel
// error for Next's runtime to catch. In tests we just want to observe the
// target URL it was called with.
const redirectMock = vi.fn((target: string) => {
  throw new Error(`REDIRECT:${target}`)
})

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}))

async function callPage(q?: string): Promise<string> {
  const { default: SearchPage } = await import("./page")
  try {
    await SearchPage({ searchParams: Promise.resolve({ q }) })
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("REDIRECT:")) {
      return err.message.slice("REDIRECT:".length)
    }
    throw err
  }
  throw new Error("redirect was not called")
}

describe("SearchPage redirect", () => {
  afterEach(() => {
    redirectMock.mockClear()
  })

  it("redirects to /?q=<encoded> when q is present", async () => {
    const target = await callPage("forgiveness")
    expect(target).toBe("/?q=forgiveness")
  })

  it("redirects to / when q is undefined", async () => {
    const target = await callPage(undefined)
    expect(target).toBe("/")
  })

  it("redirects to / when q is empty string", async () => {
    const target = await callPage("")
    expect(target).toBe("/")
  })

  it("redirects to / when q is whitespace only", async () => {
    const target = await callPage("   ")
    expect(target).toBe("/")
  })

  it("url-encodes special characters", async () => {
    const target = await callPage("peace & love")
    expect(target).toBe("/?q=peace%20%26%20love")
  })

  it("clamps q to 200 characters before encoding", async () => {
    const long = "a".repeat(500)
    const target = await callPage(long)
    expect(target).toBe(`/?q=${"a".repeat(200)}`)
  })
})
