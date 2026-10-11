import { describe, expect, it } from "vitest"

import {
  HistoricalAnalyticsError,
  readHistoricalDefinition,
  type HistoricalAnalyticsReader,
} from "./historical-analytics"

const cutoff = "2026-10-05T00:00:00.000Z"
const qualified = {
  provider: "fixture" as const,
  queryId: "watch-history-fixture-v1",
  rangeStart: "2023-01-01",
  rangeEnd: "2026-10-04",
  identity: "core_id" as const,
  botFiltering: "unknown" as const,
  measurement: "observed_events" as const,
  overlap: "unknown" as const,
  qualification: {
    sourceTable: "fixture.events.watch",
    observedStart: "2023-01-01",
    observedEnd: "2026-10-04",
    watchScope: {
      version: "jesusfilm-watch-v1" as const,
      hosts: ["jesusfilm.org", "www.jesusfilm.org"] as const,
      pathRule: "watch-route-and-children" as const,
      totalEvents: 12,
      includedEvents: 7,
      missingUrlEvents: 1,
      malformedUrlEvents: 1,
      excludedHostEvents: 1,
      excludedPathEvents: 2,
    },
    videoIdCoverage: {
      eventName: "videostarts" as const,
      inScopeEvents: 4,
      withIdEvents: 3,
      mappedEvents: null,
    },
    engagement: {
      definitionVersion: "watch-videostarts-v1" as const,
      botBasis: "unverified" as const,
      overlapIdentity: "unknown" as const,
    },
    transitions: {
      status: "available" as const,
      definitionVersion: "consecutive-videostarts-v1" as const,
      continuity: "all_video_starts" as const,
      sessionIdentity: "verified" as const,
      ordering: "timestamp_and_sequence" as const,
      botBasis: "unverified" as const,
      overlapIdentity: "unknown" as const,
    },
  },
}

function reader(definition: unknown): HistoricalAnalyticsReader {
  return {
    describe: async () =>
      definition as Awaited<ReturnType<HistoricalAnalyticsReader["describe"]>>,
    readPage: async () => {
      throw new Error("an invalid source must fail before querying")
    },
  }
}

describe("bounded historical source qualification", () => {
  it("preserves a source preflight failure instead of disguising it as missing access", async () => {
    await expect(
      readHistoricalDefinition(
        {
          describe: async () => {
            throw new HistoricalAnalyticsError("analytics_incomplete")
          },
          readPage: async () => {
            throw new Error("must not query")
          },
        },
        cutoff,
      ),
    ).rejects.toMatchObject({ code: "analytics_incomplete" })
  })

  it("accepts a fully covered, event-weighted Watch source", async () => {
    await expect(
      readHistoricalDefinition(reader(qualified), cutoff),
    ).resolves.toMatchObject({ qualification: qualified.qualification })
  })

  it("rejects an unqualified or totals-only source before a required history build", async () => {
    const withoutQualification = { ...qualified, qualification: undefined }
    await expect(
      readHistoricalDefinition(reader(withoutQualification), cutoff),
    ).rejects.toMatchObject({ code: "analytics_unavailable" })
    await expect(
      readHistoricalDefinition(
        reader({
          ...qualified,
          qualification: {
            ...qualified.qualification,
            transitions: {
              status: "unavailable",
              reason: "missing_session_identity",
            },
          },
        }),
        cutoff,
      ),
    ).rejects.toMatchObject({
      code: "analytics_transition_missing_session_identity",
    })
  })

  it("rejects partial dates and inconsistent event-weighted coverage", async () => {
    await expect(
      readHistoricalDefinition(
        reader({
          ...qualified,
          qualification: {
            ...qualified.qualification,
            observedEnd: "2023-07-16",
          },
        }),
        cutoff,
      ),
    ).rejects.toMatchObject({ code: "analytics_incomplete" })
    await expect(
      readHistoricalDefinition(
        reader({
          ...qualified,
          qualification: {
            ...qualified.qualification,
            watchScope: {
              ...qualified.qualification.watchScope,
              includedEvents: 8,
            },
          },
        }),
        cutoff,
      ),
    ).rejects.toMatchObject({ code: "analytics_incomplete" })
  })

  it("rejects a source claiming a different host or path policy", async () => {
    await expect(
      readHistoricalDefinition(
        reader({
          ...qualified,
          qualification: {
            ...qualified.qualification,
            watchScope: {
              ...qualified.qualification.watchScope,
              hosts: ["staging.jesusfilm.org", "www.jesusfilm.org"],
            },
          },
        }),
        cutoff,
      ),
    ).rejects.toMatchObject({ code: "analytics_unavailable" })
    await expect(
      readHistoricalDefinition(
        reader({
          ...qualified,
          qualification: {
            ...qualified.qualification,
            watchScope: {
              ...qualified.qualification.watchScope,
              pathRule: "watch-prefix-including-watching",
            },
          },
        }),
        cutoff,
      ),
    ).rejects.toMatchObject({ code: "analytics_unavailable" })
  })

  it("bounds the source-table identifier before persisting provenance", async () => {
    const atLimit = `${"a".repeat(187)}.b.c`
    const overLimit = `${"a".repeat(188)}.b.c`
    await expect(
      readHistoricalDefinition(
        reader({
          ...qualified,
          qualification: { ...qualified.qualification, sourceTable: atLimit },
        }),
        cutoff,
      ),
    ).resolves.toMatchObject({ qualification: { sourceTable: atLimit } })
    await expect(
      readHistoricalDefinition(
        reader({
          ...qualified,
          qualification: { ...qualified.qualification, sourceTable: overLimit },
        }),
        cutoff,
      ),
    ).rejects.toMatchObject({ code: "analytics_unavailable" })
  })

  it("cannot qualify transitions computed after removing non-Watch starts", async () => {
    await expect(
      readHistoricalDefinition(
        reader({
          ...qualified,
          qualification: {
            ...qualified.qualification,
            transitions: {
              ...qualified.qualification.transitions,
              continuity: "watch_only",
            },
          },
        }),
        cutoff,
      ),
    ).rejects.toMatchObject({ code: "analytics_unavailable" })
  })
})
