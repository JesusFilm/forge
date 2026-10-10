import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {} as {
    MASTRA_TRANSCRIPT_INGEST_API_KEYS?: string
    MASTRA_EXPERIENCE_INGEST_API_KEYS?: string
  },
}))

const { env } = await import("@/config/env")
const {
  isValidMastraExperienceIngestBearer,
  isValidMastraTranscriptIngestBearer,
} = await import("@/auth/mastra-ingest-bearer")

const envMutable = env as {
  MASTRA_TRANSCRIPT_INGEST_API_KEYS?: string
  MASTRA_EXPERIENCE_INGEST_API_KEYS?: string
}

describe("Mastra ingest bearer validation", () => {
  beforeEach(() => {
    envMutable.MASTRA_TRANSCRIPT_INGEST_API_KEYS = "mastra-a,mastra-b"
    envMutable.MASTRA_EXPERIENCE_INGEST_API_KEYS = "experience-a,experience-b"
  })

  afterEach(() => {
    envMutable.MASTRA_TRANSCRIPT_INGEST_API_KEYS = undefined
    envMutable.MASTRA_EXPERIENCE_INGEST_API_KEYS = undefined
  })

  it("accepts a matching bearer token", () => {
    expect(isValidMastraTranscriptIngestBearer("Bearer mastra-a")).toBe(true)
    expect(isValidMastraTranscriptIngestBearer("bearer mastra-b")).toBe(true)
  })

  it("rejects missing, malformed, unknown, and empty bearer values", () => {
    expect(isValidMastraTranscriptIngestBearer(null)).toBe(false)
    expect(isValidMastraTranscriptIngestBearer("Basic mastra-a")).toBe(false)
    expect(isValidMastraTranscriptIngestBearer("Bearer wrong")).toBe(false)
    expect(isValidMastraTranscriptIngestBearer("Bearer    ")).toBe(false)
  })

  it("rejects when the allowlist is unset or empty", () => {
    envMutable.MASTRA_TRANSCRIPT_INGEST_API_KEYS = undefined
    expect(isValidMastraTranscriptIngestBearer("Bearer mastra-a")).toBe(false)

    envMutable.MASTRA_TRANSCRIPT_INGEST_API_KEYS = " , "
    expect(isValidMastraTranscriptIngestBearer("Bearer mastra-a")).toBe(false)
  })

  it("does not throw for length-mismatched unicode keys", () => {
    envMutable.MASTRA_TRANSCRIPT_INGEST_API_KEYS = "kéy"
    expect(() =>
      isValidMastraTranscriptIngestBearer("Bearer key"),
    ).not.toThrow()
    expect(isValidMastraTranscriptIngestBearer("Bearer key")).toBe(false)
  })

  it("keeps transcript and experience ingest capabilities separated", () => {
    expect(isValidMastraExperienceIngestBearer("Bearer experience-a")).toBe(
      true,
    )
    expect(isValidMastraTranscriptIngestBearer("Bearer experience-a")).toBe(
      false,
    )
    expect(isValidMastraExperienceIngestBearer("Bearer mastra-a")).toBe(false)
  })
})
