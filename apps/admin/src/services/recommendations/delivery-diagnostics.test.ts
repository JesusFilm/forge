import { describe, expect, it } from "vitest"
import {
  DeliveryDiagnosticsSchema,
  readDeliveryAudioContext,
  readDeliveryDiagnostics,
} from "./delivery-diagnostics"

const diagnostics = {
  version: 1 as const,
  transcriptLocale: "zh",
  presentationLocale: "zh-hant",
  audioLanguageSlug: "mandarin-china",
  retrieval: {
    seed: "available" as const,
    presentationAvailable: false,
    exactAudioAvailable: true,
    nearestChunks: 384,
    eligibleVideos: 0,
    returnedCandidates: 0,
  },
  curated: { state: "missing_context" as const, nominatedCount: 0 },
  candidateSource: "fresh" as const,
  requestedCount: 6,
  composedCount: 0,
}

describe("bounded delivery diagnostics", () => {
  it("retains exact audio for an empty row independently of served snapshots", () => {
    expect(
      readDeliveryAudioContext({
        deliveryDiagnostics: diagnostics,
        servedItemPayload: null,
        items: [],
      }),
    ).toBe("mandarin-china")
    expect(readDeliveryDiagnostics(diagnostics)).toEqual(diagnostics)
  })

  it("keeps historical empty, malformed and conflicting audio unknown", () => {
    expect(
      readDeliveryAudioContext({ servedItemPayload: null, items: [] }),
    ).toBeNull()
    expect(
      readDeliveryDiagnostics({ ...diagnostics, sessionDigest: "secret" }),
    ).toBeNull()
    expect(
      readDeliveryDiagnostics({
        ...diagnostics,
        transcriptLocale: "viewer@example.com",
      }),
    ).toBeNull()
    expect(
      readDeliveryDiagnostics({
        ...diagnostics,
        retrieval: { ...diagnostics.retrieval, nearestChunks: 385 },
      }),
    ).toBeNull()
    expect(
      readDeliveryAudioContext({
        servedItemPayload: { version: 99 },
        items: [{ id: "one", presentation: {}, candidateProvenance: {} }],
      }),
    ).toBeNull()
    expect(
      readDeliveryAudioContext({
        servedItemPayload: null,
        items: ["english", "gbii"].map((audioLanguageSlug) => ({
          id: audioLanguageSlug,
          presentation: { audioLanguageSlug },
          candidateProvenance: {},
        })),
      }),
    ).toBeNull()
  })

  it.each(["legacy", "packed"] as const)(
    "reads historical %s snapshots without assuming locale means audio",
    (format) => {
      const rows = ["one", "two"].map((id) => ({
        id,
        presentation: { locale: "en", audioLanguageSlug: "gbii" },
        candidateProvenance: {},
      }))
      const servedItemPayload =
        format === "legacy"
          ? null
          : {
              version: 1,
              items: Object.fromEntries(
                rows.map((row) => [
                  row.id,
                  {
                    presentation: row.presentation,
                    candidateProvenance: row.candidateProvenance,
                  },
                ]),
              ),
            }
      const items =
        format === "legacy"
          ? rows
          : rows.map((row) => ({
              ...row,
              presentation: {},
              candidateProvenance: {},
            }))
      expect(readDeliveryAudioContext({ servedItemPayload, items })).toBe(
        "gbii",
      )
    },
  )

  it("fits maximal valid context and counts below the database byte ceiling", () => {
    const maximal = DeliveryDiagnosticsSchema.parse({
      ...diagnostics,
      transcriptLocale: "abcdefgh-abcdefgh-abcdefgh-abcde",
      presentationLocale: "abcdefgh-abcdefgh-abcdefgh-abcde",
      audioLanguageSlug: "a".repeat(64),
      retrieval: {
        ...diagnostics.retrieval,
        seed: "compatible_embedding_unavailable",
        nearestChunks: 384,
        eligibleVideos: 384,
        returnedCandidates: 384,
      },
      requestedCount: 64,
      composedCount: 64,
    })
    expect(Buffer.byteLength(JSON.stringify(maximal))).toBeLessThan(1024)
  })
})
