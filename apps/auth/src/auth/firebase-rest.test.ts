import { beforeEach, describe, expect, it, vi } from "vitest"

async function loadFirebaseRest() {
  vi.resetModules()
  return import("./firebase-rest")
}

describe("signInWithFirebasePassword", () => {
  beforeEach(() => {
    vi.stubEnv("FIREBASE_WEB_API_KEY", "")
    vi.restoreAllMocks()
  })

  it("returns null when Firebase web API key is not configured", async () => {
    const { signInWithFirebasePassword } = await loadFirebaseRest()

    await expect(
      signInWithFirebasePassword("user@example.com", "password"),
    ).resolves.toBeNull()
  })

  it("returns the Firebase id token for successful password sign-in", async () => {
    vi.stubEnv("FIREBASE_WEB_API_KEY", "firebase-key")
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          email: "user@example.com",
          idToken: "firebase-id-token",
        }),
        { status: 200 },
      ),
    )
    const { signInWithFirebasePassword } = await loadFirebaseRest()

    await expect(
      signInWithFirebasePassword("user@example.com", "password"),
    ).resolves.toEqual({
      email: "user@example.com",
      idToken: "firebase-id-token",
    })
  })
})
