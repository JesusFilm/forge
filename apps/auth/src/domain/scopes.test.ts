import { describe, expect, it } from "vitest"

import { assertKnownScopes, describeScopes, isKnownScope } from "./scopes"

describe("Auth scopes", () => {
  it("recognizes known scope keys", () => {
    expect(isKnownScope("openid")).toBe(true)
    expect(isKnownScope("offline_access")).toBe(true)
    expect(isKnownScope("admin:access")).toBe(true)
    expect(isKnownScope("manager:access")).toBe(true)
    expect(isKnownScope("mastra-studio:access")).toBe(true)
    expect(isKnownScope("experience:publish")).toBe(true)
    expect(isKnownScope("made:up")).toBe(false)
  })

  it("deduplicates known scopes", () => {
    expect(assertKnownScopes(["openid", "openid", "email:read"])).toEqual([
      "openid",
      "email:read",
    ])
  })

  it("rejects unknown scopes", () => {
    expect(() => assertKnownScopes(["openid", "not:real"])).toThrow(
      "Unknown Auth scope(s): not:real",
    )
  })

  it("returns user-facing scope descriptions in catalog order", () => {
    expect(
      describeScopes(["email:read", "openid"]).map((scope) => scope.key),
    ).toEqual(["openid", "email:read"])
  })

  it("describes offline_access without implying Admin permission", () => {
    expect(describeScopes(["offline_access"])).toEqual([
      expect.objectContaining({
        key: "offline_access",
        label: "Stay connected",
      }),
    ])
  })

  it("describes Admin MCP Experience scopes for consent screens", () => {
    expect(
      describeScopes([
        "experience:publish",
        "video:read",
        "experience:read",
        "media:read",
      ]),
    ).toEqual([
      expect.objectContaining({
        key: "experience:read",
        label: "Read experiences",
      }),
      expect.objectContaining({
        key: "media:read",
        label: "Read media",
      }),
      expect.objectContaining({
        key: "video:read",
        label: "Read videos",
      }),
      expect.objectContaining({
        key: "experience:publish",
        label: "Publish experience locales",
      }),
    ])
  })
})
