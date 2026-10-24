import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  claimRun: vi.fn(),
  completeRun: vi.fn(),
  getLatestManifest: vi.fn(),
}))

vi.mock("@/auth/seo-service-assertion", () => ({
  SEO_WORKLOAD_ASSERTION_HEADER: "x-forge-seo-assertion",
  verifySeoWorkloadAssertion: mocks.verify,
}))

vi.mock("@/db/client", () => ({ prisma: {} }))

vi.mock("@/services/watch-route-manifest-store", () => ({
  WatchRouteManifestStore: class {
    getLatest = mocks.getLatestManifest
  },
}))

vi.mock("@/services/watch-route-alert.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/services/watch-route-alert.service")
    >()
  return {
    ...actual,
    WatchRouteAlertService: class {
      claimRun = mocks.claimRun
      completeRun = mocks.completeRun
    },
  }
})

import { SeoAssertionInvalidError } from "@/auth/seo-assertion-keyring"
import { SeoAssertionReplayError } from "@/auth/seo-assertion-ledger"
import { POST } from "./route"

const assertion = {
  keyId: "test-key",
  environment: "test",
  audience: "forge-admin:seo:watch_alerts",
  capability: "watch_alerts",
  requestDigest: "a".repeat(64),
  jtiHash: "b".repeat(64),
  expiresAt: new Date("2099-01-01T00:00:00.000Z"),
}

const claimInput = {
  propertyId: "320198532",
  origin: "https://www.jesusfilm.org",
  contractVersion: "watch-route-alerts/v1",
  mode: "live",
  windowStart: "2026-09-01T00:00:00.000Z",
  windowEnd: "2026-09-03T23:59:59.999Z",
  leaseSeconds: 300,
  reprobeLimit: 25,
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

function request(body: unknown, token = "signed-assertion") {
  return new Request("https://admin.test/api/seo/watch-route-alerts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forge-seo-assertion": token,
    },
    body: JSON.stringify(body),
  })
}

describe("POST /api/seo/watch-route-alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.verify.mockResolvedValue(assertion)
    mocks.getLatestManifest.mockResolvedValue({
      payload: manifest,
    })
    mocks.claimRun.mockResolvedValue({
      run: { id: "run-1" },
      claim: { generation: 1, token: "claim-token" },
      replayed: false,
      openAlerts: [],
    })
  })

  it("verifies the signed body and returns the manifest with a new claim", async () => {
    const body = { action: "claim_run", input: claimInput }
    const response = await POST(request(body))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: {
        run: { id: "run-1" },
        manifest,
      },
    })
    expect(mocks.verify).toHaveBeenCalledWith({
      assertion: "signed-assertion",
      capability: "watch_alerts",
      rawBody: JSON.stringify(body),
    })
    expect(mocks.claimRun).toHaveBeenCalledWith({
      assertion,
      input: claimInput,
    })
  })

  it("fails closed when the route manifest is unavailable", async () => {
    mocks.getLatestManifest.mockResolvedValue(null)

    const response = await POST(
      request({ action: "claim_run", input: claimInput }),
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "watch_route_manifest_unavailable",
    })
    expect(mocks.claimRun).not.toHaveBeenCalled()
  })

  it.each([
    [new SeoAssertionInvalidError(), 401, "invalid_assertion"],
    [new SeoAssertionReplayError(), 409, "assertion_replayed"],
  ] as const)(
    "maps assertion failures without leaking detail",
    async (error, status, code) => {
      if (error instanceof SeoAssertionInvalidError) {
        mocks.verify.mockRejectedValue(error)
      } else {
        mocks.claimRun.mockRejectedValue(error)
      }

      const response = await POST(
        request({ action: "claim_run", input: claimInput }),
      )

      expect(response.status).toBe(status)
      await expect(response.json()).resolves.toEqual({ ok: false, error: code })
    },
  )
})
