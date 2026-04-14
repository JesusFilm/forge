import { afterEach, describe, expect, it, vi } from "vitest"

describe("signInWithFirebasePassword", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("returns null when the Firebase web API key is not configured", async () => {
    vi.stubEnv("FIREBASE_WEB_API_KEY", "")
    const { signInWithFirebasePassword } = await import("./firebase-rest")
    await expect(
      signInWithFirebasePassword("editor@example.com", "secret"),
    ).resolves.toBeNull()
  })

  it("returns the parsed auth payload on success", async () => {
    vi.stubEnv("FIREBASE_WEB_API_KEY", "firebase-web-key")
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          email: "editor@example.com",
          idToken: "firebase-id-token",
          localId: "firebase-uid",
          refreshToken: "refresh-token",
          registered: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    const { signInWithFirebasePassword } = await import("./firebase-rest")
    await expect(
      signInWithFirebasePassword("editor@example.com", "secret"),
    ).resolves.toEqual({
      email: "editor@example.com",
      idToken: "firebase-id-token",
      localId: "firebase-uid",
      refreshToken: "refresh-token",
    })
  })

  it("returns null on failed Firebase auth", async () => {
    vi.stubEnv("FIREBASE_WEB_API_KEY", "firebase-web-key")
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "INVALID_PASSWORD" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    )

    const { signInWithFirebasePassword } = await import("./firebase-rest")
    await expect(
      signInWithFirebasePassword("editor@example.com", "wrong"),
    ).resolves.toBeNull()
  })
})
