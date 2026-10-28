import { describe, expect, it } from "vitest"
import {
  createRecommendationEventEnvelope,
  parseRecommendationEventEnvelope,
  RecommendationEventEnvelopeError,
} from "./envelope"

const input = {
  family: "playback-fact" as const,
  logicalId: "episode-1/fact-1",
  revision: 1,
  occurredAt: new Date("2026-10-28T01:00:00.000Z"),
  acceptedAt: new Date("2026-10-28T01:00:01.000Z"),
  expiresAt: new Date("2026-11-11T01:00:00.000Z"),
  payload: { kind: "STARTED", sequence: 1 },
  allowedFields: ["kind", "sequence"] as const,
}

describe("recommendation event envelope", () => {
  it("keeps a stable identity, digest and original expiry across serialization", () => {
    const first = createRecommendationEventEnvelope(input)
    const second = createRecommendationEventEnvelope({
      ...input,
      payload: { sequence: 1, kind: "STARTED" },
    })
    expect(first).toEqual(second)
    expect(first.version).toBe(1)
    expect(first.expiresAt).toBe("2026-11-11T01:00:00.000Z")
    expect(parseRecommendationEventEnvelope(JSON.stringify(first))).toEqual(
      first,
    )
  })

  it("allows a fact timestamp slightly ahead of server acceptance", () => {
    const event = createRecommendationEventEnvelope({
      ...input,
      occurredAt: new Date("2026-10-28T01:04:00.000Z"),
    })
    expect(event.occurredAt).toBe("2026-10-28T01:04:00.000Z")
  })

  it("accepts a bounded request trace larger than a small fact", () => {
    const event = createRecommendationEventEnvelope({
      ...input,
      payload: { kind: "x".repeat(32_000) },
    })
    expect(
      parseRecommendationEventEnvelope(JSON.stringify(event)).payload.kind,
    ).toHaveLength(32_000)
  })

  it("rejects unapproved fields, secrets, malformed dates and oversized payloads", () => {
    expect(() =>
      createRecommendationEventEnvelope({
        ...input,
        payload: { kind: "STARTED", bearerToken: "secret" },
        allowedFields: ["kind", "bearerToken"],
      }),
    ).toThrow()
    expect(() =>
      createRecommendationEventEnvelope({
        ...input,
        payload: { kind: "STARTED", arbitrary: "body" },
      }),
    ).toThrow()
    expect(() =>
      createRecommendationEventEnvelope({
        ...input,
        expiresAt: new Date("2026-10-27T01:00:00.000Z"),
      }),
    ).toThrow()
    expect(() =>
      createRecommendationEventEnvelope({
        ...input,
        payload: { kind: "x".repeat(130_000) },
      }),
    ).toThrow()
    const event = createRecommendationEventEnvelope(input)
    expect(() =>
      parseRecommendationEventEnvelope(
        JSON.stringify({
          ...event,
          payload: { kind: "STOPPED", sequence: 1 },
        }),
      ),
    ).toThrow("digest")
  })

  it("reports malformed JSON and unsafe payloads as sanitized invalid input", () => {
    for (const parse of [
      () => parseRecommendationEventEnvelope('{"payload":'),
      () =>
        createRecommendationEventEnvelope({
          ...input,
          payload: { sessionDigest: "private-value" },
          allowedFields: ["sessionDigest"],
        }),
    ]) {
      try {
        parse()
        throw new Error("Expected invalid input")
      } catch (error) {
        expect(error).toBeInstanceOf(RecommendationEventEnvelopeError)
        expect((error as RecommendationEventEnvelopeError).code).toBe(
          "invalid_input",
        )
        expect(String(error)).not.toContain("private-value")
      }
    }
  })
})
