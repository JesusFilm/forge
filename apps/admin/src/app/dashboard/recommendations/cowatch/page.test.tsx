import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const requireSessionMock = vi.fn()
const loadInspectionMock = vi.fn()
const redirectMock = vi.fn((destination: string) => {
  throw new Error(`REDIRECT:${destination}`)
})

vi.mock("@/auth/session", () => ({
  requireSession: () => requireSessionMock(),
}))
vi.mock("@/auth/permissions", () => ({
  hasPermission: (principal: { role: string }) => principal.role === "ADMIN",
}))
vi.mock("@/db/client", () => ({ prisma: {} }))
vi.mock("@/config/env", () => ({
  env: { ADMIN_SESSION_SECRET: "test-admin-session-secret-at-least-32-chars" },
}))
vi.mock("next/navigation", () => ({
  redirect: (destination: string) => redirectMock(destination),
}))
vi.mock("@/services/recommendations/cowatch/inspection.service", () => ({
  loadCowatchInspection: (...args: unknown[]) => loadInspectionMock(...args),
}))

import CowatchInspectionPage from "./page"

const edge = {
  contractVersion: "directional-cowatch-feature-v1",
  generation: "a".repeat(64),
  sourceMediaId: "video-A",
  targetMediaId: "video-B",
  sessionSupport: 4,
  distinctViewerSupport: 4,
  confidence: 0.45,
  popularityCorrectedLift: 1.8,
  recencyWeight: 0.7,
  qualityWeight: 0.8,
  effectiveWeight: 2.2,
  contamination: 0.25,
  eligible: true,
}

describe("authorized co-watch Admin inspection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadInspectionMock.mockResolvedValue({
      generation: "a".repeat(64),
      shadowEvaluation: {
        id: "evaluation-1",
        state: "TERMINAL",
        decision: "INCONCLUSIVE",
        reasonCode: "cowatch_controlled_evaluation_required",
        processedCount: 30,
        sampledCount: 30,
        coverage: 0.4,
        overlap: 0.2,
        latencyP95Ms: 123,
      },
      publishedAt: new Date("2026-09-28T00:00:00.000Z"),
      sourceCount: 12,
      contributionCount: 4,
      edgeCount: 2,
      distinctViewerCount: 8,
      state: "current",
      staleReasons: [],
      terminalDecision: "no_promotion",
      decisionReason: "controlled_evaluation_required_feat_505",
      anchors: [
        {
          mediaId: "video-A",
          kind: "session",
          interestOrdinal: 0,
          weight: 0.9,
        },
      ],
      selectedEdges: [edge],
      reverseEdges: [
        {
          ...edge,
          sourceMediaId: "video-B",
          targetMediaId: "video-A",
          confidence: 0.2,
        },
      ],
      candidates: [edge],
      overlapMediaIds: ["video-B"],
      candidateDecision: "shadow_candidates_available",
    })
  })

  it("rejects unauthorized access before inspecting evidence", async () => {
    requireSessionMock.mockResolvedValue({ id: "viewer", role: "VIEWER" })
    await expect(
      CowatchInspectionPage({
        searchParams: Promise.resolve({ anchor: "video-A" }),
      }),
    ).rejects.toThrow("REDIRECT:/dashboard")
    expect(loadInspectionMock).not.toHaveBeenCalled()
  })

  it("shows both directions, anchor, overlap and terminal decision with audited request identity", async () => {
    requireSessionMock.mockResolvedValue({ id: "admin-1", role: "ADMIN" })
    const html = renderToStaticMarkup(
      await CowatchInspectionPage({
        searchParams: Promise.resolve({
          anchor: "video-A",
          request: "request-1",
        }),
      }),
    )
    expect(html).toContain("video-A → video-B")
    expect(html).toContain("video-B → video-A")
    expect(html).toContain("No promotion")
    expect(html).toContain("INCONCLUSIVE")
    expect(html).toContain("30/30 processed")
    expect(html).toContain("controlled evaluation required feat 505")
    expect(html).toContain("video-A (session, weight 0.90)")
    expect(html).toContain("Candidate overlap")
    expect(loadInspectionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sourceMediaId: "video-A",
        requestId: "request-1",
        actorDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    )
  })
})
