import { describe, expect, it } from "vitest"

import { resolveMobileCallbackURL } from "./mobile-callback"

describe("resolveMobileCallbackURL", () => {
  it("passes the app-scheme callback the Expo client sends", () => {
    expect(resolveMobileCallbackURL("forgemobile:///")).toBe("forgemobile:///")
    expect(resolveMobileCallbackURL("forgemobile://profile?x=1")).toBe(
      "forgemobile://profile?x=1",
    )
  })

  it("does not claim web, other-scheme, or unparseable callbacks", () => {
    expect(resolveMobileCallbackURL("https://auth.jesusfilm.org/")).toBe(
      undefined,
    )
    expect(resolveMobileCallbackURL("http://localhost:3000/watch")).toBe(
      undefined,
    )
    expect(resolveMobileCallbackURL("otherapp:///")).toBe(undefined)
    expect(resolveMobileCallbackURL("forgemobile-evil:///")).toBe(undefined)
    expect(resolveMobileCallbackURL("not a url")).toBe(undefined)
    expect(resolveMobileCallbackURL("")).toBe(undefined)
    expect(resolveMobileCallbackURL(undefined)).toBe(undefined)
    expect(resolveMobileCallbackURL(42)).toBe(undefined)
  })
})
