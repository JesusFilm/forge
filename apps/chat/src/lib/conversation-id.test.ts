import { describe, expect, it } from "vitest"

import {
  UUID_PATTERN,
  isConversationId,
  toConversationId,
} from "./conversation-id"

const LOWER_UUID = "0f6d3f1e-1111-4a2b-8c3d-000000000042"
const UPPER_UUID = "0F6D3F1E-1111-4A2B-8C3D-000000000042"

// The shapes a hostile or mangled /c/<id> URL segment could carry.
const INVALID_VALUES: unknown[] = [
  "",
  undefined,
  null,
  42,
  { id: LOWER_UUID },
  [LOWER_UUID],
  `${LOWER_UUID}/messages`, // trailing path segment
  LOWER_UUID.slice(0, 35), // 35-char near-miss (a UUID is 36)
  "0f6d3f1e%2D1111-4a2b-8c3d-000000000042", // %-encoded hyphen
]

describe("isConversationId", () => {
  it("accepts a canonical lowercase UUID", () => {
    expect(isConversationId(LOWER_UUID)).toBe(true)
    expect(isConversationId(crypto.randomUUID())).toBe(true)
  })

  it("accepts an uppercase UUID (shape only — canonicalization is toConversationId's job)", () => {
    expect(isConversationId(UPPER_UUID)).toBe(true)
  })

  it("rejects empty, non-string, and near-miss shapes", () => {
    for (const bad of INVALID_VALUES) {
      expect(isConversationId(bad)).toBe(false)
    }
  })
})

describe("toConversationId", () => {
  it("returns a canonical lowercase UUID unchanged", () => {
    expect(toConversationId(LOWER_UUID)).toBe(LOWER_UUID)
  })

  it("canonicalizes an uppercase deep link to lowercase (never seeds a duplicate row)", () => {
    expect(toConversationId(UPPER_UUID)).toBe(LOWER_UUID)
  })

  it("returns null for every invalid shape", () => {
    for (const bad of INVALID_VALUES) {
      expect(toConversationId(bad)).toBeNull()
    }
  })
})

describe("UUID_PATTERN", () => {
  it("is anchored — a UUID embedded in a longer string does not match", () => {
    expect(UUID_PATTERN.test(`x${LOWER_UUID}`)).toBe(false)
    expect(UUID_PATTERN.test(`${LOWER_UUID}x`)).toBe(false)
  })
})
