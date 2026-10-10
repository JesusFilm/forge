// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

// Mock next/headers so getChatIdentity can run outside a Next request context.
const cookieStore = { value: undefined as string | undefined }
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "forge_chat_session" && cookieStore.value !== undefined
        ? { value: cookieStore.value }
        : undefined,
  }),
}))

beforeAll(() => {
  vi.stubEnv("CHAT_SESSION_SECRET", "s".repeat(40))
})

beforeEach(() => {
  cookieStore.value = undefined
})

describe("getChatIdentity (R3/R5 — display-only, never redirects)", () => {
  it("returns the claims for a valid session cookie", async () => {
    const { createChatSessionCookie } = await import("./session-cookie")
    cookieStore.value = await createChatSessionCookie({
      sub: "user-123",
      name: "Ada",
    })
    const { getChatIdentity } = await import("./identity")
    expect(await getChatIdentity()).toMatchObject({
      sub: "user-123",
      name: "Ada",
    })
  })

  it("returns null (no redirect) when the cookie is absent", async () => {
    const { getChatIdentity } = await import("./identity")
    expect(await getChatIdentity()).toBeNull()
  })

  it("returns null for an invalid cookie value", async () => {
    cookieStore.value = "not.a.jwt"
    const { getChatIdentity } = await import("./identity")
    expect(await getChatIdentity()).toBeNull()
  })
})
