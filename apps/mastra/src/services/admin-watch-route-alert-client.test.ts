import { describe, expect, it, vi } from "vitest"

import { getSeoConfig } from "../config/seo"
import { claimWatchRouteAlertRun } from "./admin-watch-route-alert-client"

const config = getSeoConfig({
  SEO_ADMIN_BASE_URL: "https://admin.example",
  SEO_ADMIN_ALLOWED_HOSTS: "admin.example",
  SEO_WORKLOAD_KEY_ID: "key-1",
  SEO_WORKLOAD_PRIVATE_KEY: "configured-by-test-seam",
})

const input = {
  propertyId: "320198532",
  origin: "https://www.jesusfilm.org",
  contractVersion: "watch-route-alerts/v1",
  mode: "live" as const,
  windowStart: "2026-09-01T00:00:00.000Z",
  windowEnd: "2026-09-03T23:59:59.999Z",
  leaseSeconds: 300,
  reprobeLimit: 25,
}

function claimEnvelope(manifest: unknown) {
  return {
    ok: true,
    result: {
      run: {
        id: "run-1",
        propertyId: "320198532",
        mode: "live",
        status: "running",
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        startedAt: "2026-09-04T12:15:00.000Z",
        completedAt: null,
      },
      claim: {
        generation: 1,
        token: "claim-token-long-enough",
        expiresAt: "2026-09-04T12:20:00.000Z",
      },
      replayed: false,
      openAlerts: [],
      manifest,
    },
  }
}

const manifest = {
  version: "manifest-v1",
  generatedAt: "2026-09-04T12:00:00.000Z",
  contentSlugs: ["jesus"],
  oneSegmentSlugs: ["jesus"],
  homepageLocales: ["english"],
  episodePairsByParent: {},
  audioLanguageSlugs: ["english"],
  audioLanguageIndexesByContent: { jesus: [0] },
  audioLanguageIndexesByEpisode: {},
  nestedContainerAudioLanguageIndexesByParent: {},
}

const options = (body: unknown) => ({
  config,
  fetchImpl: vi.fn(async () => Response.json(body)) as unknown as typeof fetch,
  resolveHost: async () => [{ address: "93.184.216.34" }],
  sign: vi.fn(async () => "signed"),
})

describe("Admin Watch route alert client contract", () => {
  it("accepts the complete claim envelope emitted by Admin", async () => {
    await expect(
      claimWatchRouteAlertRun(input, options(claimEnvelope(manifest))),
    ).resolves.toMatchObject({
      ok: true,
      result: { run: { id: "run-1" }, manifest: { version: "manifest-v1" } },
    })
  })

  it("fails closed when Admin returns an incomplete manifest shape", async () => {
    await expect(
      claimWatchRouteAlertRun(
        input,
        options(claimEnvelope({ version: "manifest-v1" })),
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "parse_error",
      retryable: true,
    })
  })
})
