import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {} as { WORKFLOW_API_KEYS?: string },
}))

const { env } = await import("@/config/env")
const { isValidWorkflowBearer } = await import("@/auth/workflow-bearer")

const envMutable = env as { WORKFLOW_API_KEYS?: string }

describe("isValidWorkflowBearer", () => {
  beforeEach(() => {
    envMutable.WORKFLOW_API_KEYS = "key-aaa,key-bbb,key-ccc"
  })
  afterEach(() => {
    envMutable.WORKFLOW_API_KEYS = undefined
  })

  it("accepts a valid bearer token matching any allowlisted key", () => {
    expect(isValidWorkflowBearer("Bearer key-aaa")).toBe(true)
    expect(isValidWorkflowBearer("Bearer key-bbb")).toBe(true)
    expect(isValidWorkflowBearer("Bearer key-ccc")).toBe(true)
  })

  it("accepts case-insensitive Bearer prefix", () => {
    expect(isValidWorkflowBearer("bearer key-aaa")).toBe(true)
    expect(isValidWorkflowBearer("BEARER key-aaa")).toBe(true)
  })

  it("rejects an unknown key", () => {
    expect(isValidWorkflowBearer("Bearer not-a-real-key")).toBe(false)
  })

  it("rejects null / empty headers", () => {
    expect(isValidWorkflowBearer(null)).toBe(false)
    expect(isValidWorkflowBearer("")).toBe(false)
    expect(isValidWorkflowBearer("Bearer ")).toBe(false)
  })

  it("rejects non-Bearer schemes", () => {
    expect(isValidWorkflowBearer("Basic key-aaa")).toBe(false)
    expect(isValidWorkflowBearer("key-aaa")).toBe(false)
  })

  it("rejects bearer with no key (whitespace only)", () => {
    expect(isValidWorkflowBearer("Bearer    ")).toBe(false)
  })

  it("rejects when WORKFLOW_API_KEYS is unset", () => {
    envMutable.WORKFLOW_API_KEYS = undefined
    expect(isValidWorkflowBearer("Bearer key-aaa")).toBe(false)
  })

  it("rejects when WORKFLOW_API_KEYS is empty / whitespace-only", () => {
    envMutable.WORKFLOW_API_KEYS = ""
    expect(isValidWorkflowBearer("Bearer key-aaa")).toBe(false)
    envMutable.WORKFLOW_API_KEYS = "  ,  "
    expect(isValidWorkflowBearer("Bearer key-aaa")).toBe(false)
  })

  it("trims whitespace around allowlist entries", () => {
    envMutable.WORKFLOW_API_KEYS = "  key-aaa  ,  key-bbb  "
    expect(isValidWorkflowBearer("Bearer key-aaa")).toBe(true)
    expect(isValidWorkflowBearer("Bearer key-bbb")).toBe(true)
  })

  it("rejects partial / prefix matches", () => {
    expect(isValidWorkflowBearer("Bearer key-aa")).toBe(false)
    expect(isValidWorkflowBearer("Bearer key-aaaX")).toBe(false)
  })
})
