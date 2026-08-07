import { describe, expect, it } from "vitest"

import {
  buildGraphqlRequest,
  buildInternalRequest,
  parseGraphqlProbeResponse,
  summarizeProductionProbe,
} from "./benchmark-watch-search-production"

describe("production Watch Search latency probe", () => {
  it("builds MODERN GraphQL requests with analytics correlation", () => {
    const request = buildGraphqlRequest({
      query: "พระเยซูคือใคร",
      languageSlug: "thai",
      clientRequestId: "probe-graphql-0001",
    })

    expect(request).toEqual(
      expect.objectContaining({
        variables: {
          input: expect.objectContaining({
            query: "พระเยซูคือใคร",
            mode: "MODERN",
            clientRequestId: "probe-graphql-0001",
            targetLanguageSlug: "thai",
          }),
        },
      }),
    )
    expect(request.query).toContain("laneStatuses")
    expect(request.query).not.toContain("startedOffsetMs")
  })

  it("parses the public GraphQL lane status contract", () => {
    expect(
      parseGraphqlProbeResponse({
        data: {
          watchSearch: {
            requestId: "request-1",
            degraded: false,
            latencyMs: 42,
            laneStatuses: [
              {
                lane: "semantic_embedding",
                status: "fulfilled",
                elapsedMs: 8,
                resultCount: 10,
                reason: null,
                detail: "cache_l1_hit",
              },
            ],
          },
        },
      }),
    ).toMatchObject({
      requestId: "request-1",
      laneStatuses: [
        {
          lane: "semantic_embedding",
          elapsedMs: 8,
        },
      ],
    })
  })

  it("includes the required BCP-47 locale in internal probe requests", () => {
    expect(
      buildInternalRequest({
        query: "พระเยซูคือใคร",
        locale: "th",
        languageSlug: "thai",
        clientRequestId: "probe-server-0001",
      }),
    ).toMatchObject({
      query: "พระเยซูคือใคร",
      locale: "th",
      languageSlug: "thai",
      clientRequestId: "probe-server-0001",
      mode: "modern",
    })
  })

  it("separates server and full round-trip percentiles", () => {
    expect(
      summarizeProductionProbe([
        {
          clientRequestId: "probe-1",
          roundTripMs: 100,
          serverMs: 40,
          degraded: false,
          surfaceFirstSeen: true,
          laneStatuses: [
            {
              lane: "semantic_embedding",
              status: "fulfilled",
              startedOffsetMs: 0,
              elapsedMs: 20,
              resultCount: 1,
              reason: null,
              detail: "cache_miss",
            },
          ],
        },
        {
          clientRequestId: "probe-2",
          roundTripMs: 300,
          serverMs: 80,
          degraded: true,
          surfaceFirstSeen: false,
          laneStatuses: [
            {
              lane: "semantic_embedding",
              status: "fulfilled",
              startedOffsetMs: 0,
              elapsedMs: 5,
              resultCount: 1,
              reason: null,
              detail: "cache_l1_hit",
            },
          ],
        },
      ]),
    ).toEqual({
      samples: 2,
      accepted: 2,
      degraded: 1,
      server: { p50Ms: 40, p95Ms: 80 },
      roundTrip: { p50Ms: 100, p95Ms: 300 },
      surfaceFirstSeen: {
        samples: 1,
        server: { p50Ms: 40, p95Ms: 40 },
        roundTrip: { p50Ms: 100, p95Ms: 100 },
      },
      repeat: {
        samples: 1,
        server: { p50Ms: 80, p95Ms: 80 },
        roundTrip: { p50Ms: 300, p95Ms: 300 },
      },
      embeddingCache: { cache_l1_hit: 1, cache_miss: 1 },
      lanes: {
        semantic_embedding: {
          samples: 2,
          p50Ms: 5,
          p95Ms: 20,
          degraded: 0,
          skipped: 0,
        },
      },
      clientRequestIds: ["probe-1", "probe-2"],
    })
  })
})
