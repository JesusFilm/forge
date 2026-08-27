import { describe, expect, it } from "vitest"

import { assertKnownScopes, describeScopes, isKnownScope } from "./scopes"

describe("Auth scopes", () => {
  it("recognizes known scope keys", () => {
    expect(isKnownScope("openid")).toBe(true)
    expect(isKnownScope("offline_access")).toBe(true)
    expect(isKnownScope("admin:access")).toBe(true)
    expect(isKnownScope("admin:manager-backend")).toBe(true)
    expect(isKnownScope("manager:access")).toBe(true)
    expect(isKnownScope("mastra-studio:access")).toBe(true)
    expect(isKnownScope("experience:publish")).toBe(true)
    expect(isKnownScope("experience:create")).toBe(true)
    expect(isKnownScope("experience:generate")).toBe(true)
    expect(isKnownScope("changelog:read")).toBe(true)
    expect(isKnownScope("changelog:submit")).toBe(true)
    expect(isKnownScope("changelog:admin")).toBe(true)
    expect(isKnownScope("made:up")).toBe(false)
  })

  it("describes Changelog scopes with their exact consent copy", () => {
    expect(
      describeScopes(["changelog:admin", "changelog:read", "changelog:submit"]),
    ).toEqual([
      {
        key: "changelog:read",
        label: "Read Changelog",
        description: "View and filter published Changelog entries.",
      },
      {
        key: "changelog:submit",
        label: "Submit Changelog entries",
        description: "Submit entries and manage entries created by the caller.",
      },
      {
        key: "changelog:admin",
        label: "Administer Changelog",
        description: "Manage all Changelog entries and products.",
      },
    ])
  })

  it("rejects a typo'd experience-level scope", () => {
    expect(() => assertKnownScopes(["experience:creat"])).toThrow(
      "Unknown Auth scope(s): experience:creat",
    )
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
        label: "Stay signed in",
        description:
          "Allow the requesting application to keep access active without asking you to sign in again.",
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

  it("describes experience-level create and generate scopes for consent screens", () => {
    expect(
      describeScopes(["experience:generate", "experience:create"]),
    ).toEqual([
      expect.objectContaining({
        key: "experience:create",
        label: "Create experiences",
        description: "Create new Experience pages as drafts.",
      }),
      expect.objectContaining({
        key: "experience:generate",
        label: "Generate experiences",
        description: "Generate new Experience page drafts with AI.",
      }),
    ])
  })
})
