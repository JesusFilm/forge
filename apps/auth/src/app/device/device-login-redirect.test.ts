import { describe, expect, it } from "vitest"

import {
  buildDeviceLoginRedirect,
  isDeviceLoginContinuation,
} from "./device-login-redirect"

describe("buildDeviceLoginRedirect", () => {
  it("sends the signed-out visitor to the existing login surface", () => {
    expect(buildDeviceLoginRedirect("0194507302")).toContain("/login?")
  })

  it("carries the normalized user code through the login hop", () => {
    const params = new URL(
      buildDeviceLoginRedirect("019-450-7302"),
      "https://auth.example.org",
    ).searchParams

    expect(params.get("user_code")).toBe("0194507302")
  })

  it("always asks for a fresh authentication on a shared phone", () => {
    const params = new URL(
      buildDeviceLoginRedirect("0194507302"),
      "https://auth.example.org",
    ).searchParams

    expect(params.get("prompt")).toBe("login")
  })

  it("still forces re-authentication when no code was supplied", () => {
    const params = new URL(
      buildDeviceLoginRedirect(undefined),
      "https://auth.example.org",
    ).searchParams

    expect(params.get("prompt")).toBe("login")
    expect(params.has("user_code")).toBe(false)
  })

  it("omits an unusable code rather than forwarding junk", () => {
    const params = new URL(
      buildDeviceLoginRedirect("🙂🙂🙂"),
      "https://auth.example.org",
    ).searchParams

    expect(params.has("user_code")).toBe(false)
  })

  it("never sends auth's own origin as a callback", () => {
    // web-callback.ts filters the auth origin out of allowed callbacks, so a
    // callbackURL-based continuation would be silently dropped.
    expect(buildDeviceLoginRedirect("0194507302")).not.toContain("callbackURL")
  })

  it("produces a login URL that login recognizes as a device continuation", () => {
    const params = Object.fromEntries(
      new URL(
        buildDeviceLoginRedirect("019-450-7302"),
        "https://auth.example.org",
      ).searchParams,
    )

    expect(isDeviceLoginContinuation(params)).toBe(true)
  })
})

describe("isDeviceLoginContinuation", () => {
  it("recognizes a usable user code", () => {
    expect(isDeviceLoginContinuation({ user_code: "019-450-7302" })).toBe(true)
    expect(isDeviceLoginContinuation({ user_code: ["0194507302"] })).toBe(true)
  })

  it("does not open the login surface for a code-less request", () => {
    expect(isDeviceLoginContinuation({})).toBe(false)
    expect(isDeviceLoginContinuation({ user_code: "" })).toBe(false)
    expect(isDeviceLoginContinuation({ user_code: "---" })).toBe(false)
    expect(isDeviceLoginContinuation({ user_code: undefined })).toBe(false)
  })
})
