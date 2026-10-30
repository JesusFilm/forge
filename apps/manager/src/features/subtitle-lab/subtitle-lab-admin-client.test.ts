import { beforeEach, describe, expect, it, vi } from "vitest"

const proofMock = vi.hoisted(() => vi.fn(async () => "manager-session-proof"))
vi.mock("@/lib/subtitle-eval-session-proof", () => ({
  createSubtitleEvalSessionProof: proofMock,
}))

import {
  parseLeaseDigest,
  reviewerAssignmentDetailSchema,
  SubtitleLabAdminClient,
} from "./subtitle-lab-admin-client"
import type { ManagerSessionPrincipal } from "@/lib/manager-session-cookie"
import {
  canonicalDigest,
  canonicalReviewSubmissionDigest,
  normalizeReviewSubmission,
} from "./subtitle-lab-contract"

const session: ManagerSessionPrincipal = {
  id: "admin-user-1",
  subject: "auth-user-1",
  email: "reviewer@example.com",
  managerRole: "REVIEWER",
  scopes: [],
  reviewerLanguageGrants: [],
}
type SessionExchangeBody = {
  reviewerAssertionRequest?: { requestId?: string }
  subtitleEvalDelegationRequest?: { requestId?: string }
}
type GraphqlVariables = {
  input?: { rubricVersion?: number; [key: string]: unknown }
}

describe("Subtitle Lab Admin client", () => {
  beforeEach(() => vi.clearAllMocks())

  it("uses POST transport with a fresh logical GET assertion for locators", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ reviewerAssertion: "admin-assertion" })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            locator: {
              objectKey: `subtitle-eval/v1/candidate/${"a".repeat(64)}.vtt`,
              mediaType: "text/vtt",
              byteLength: "7",
              sha256: "a".repeat(64),
            },
          }),
        ),
      )
    const client = new SubtitleLabAdminClient({
      graphqlUrl: "https://admin.example/api/graphql",
      graphqlBearer: "manager-backend-token",
      oauthBearer: "oauth-service-token",
      fetchImpl,
    })
    await expect(
      client.reviewerTrackLocator(session, "assignment-1", "b".repeat(64)),
    ).resolves.toMatchObject({ mediaType: "text/vtt" })
    expect(proofMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentId: "assignment-1",
        method: "GET",
      }),
    )
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(
      "https://admin.example/api/manager/subtitle-eval/reviewer-track",
    )
    expect(fetchImpl.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer oauth-service-token",
        }),
      }),
    )
    const locatorBody = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))
    expect(locatorBody).toEqual({
      assignmentId: "assignment-1",
      contentId: "b".repeat(64),
      assertion: "admin-assertion",
    })
  })

  it("does not return locators for non-disclosing Admin denials", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ reviewerAssertion: "admin-assertion" })),
      )
      .mockResolvedValueOnce(new Response("Not found", { status: 404 }))
    const client = new SubtitleLabAdminClient({
      graphqlUrl: "https://admin.example/api/graphql",
      graphqlBearer: "manager-backend-token",
      oauthBearer: "oauth-service-token",
      fetchImpl,
    })
    await expect(
      client.reviewerTrackLocator(session, "wrong-assignment", "b".repeat(64)),
    ).resolves.toBeNull()
  })

  it("parses fenced lease digests without truncating ISO timestamps", () => {
    expect(parseLeaseDigest("3:lease-token:2026-08-20T12:34:56.000Z")).toEqual({
      generation: 3,
      executionAttempt: 3,
      token: "lease-token",
      expiresAt: "2026-08-20T12:34:56.000Z",
    })
    expect(
      parseLeaseDigest("4:lease-token:2026-08-20T12:34:56.000Z#2"),
    ).toMatchObject({ generation: 4, executionAttempt: 2 })
    expect(parseLeaseDigest("invalid")).toBeNull()
  })

  it.each(["A", "B"] as const)(
    "fails closed on Track %s provenance before submission at the Manager BFF boundary",
    (referenceTrackLabel) => {
      expect(
        reviewerAssignmentDetailSchema.safeParse({
          id: "assignment-1",
          status: "ASSIGNED",
          kind: "STANDARD",
          round: 1,
          targetLanguageId: "language-1",
          targetLanguageSlug: "spanish",
          caseId: "case-1",
          collectionKey: "JESUS_FILM",
          videoId: "video-1",
          editionIdentity: "edition-1",
          clipStartSeconds: 0,
          clipEndSeconds: 10,
          submitted: false,
          postSubmitReceipt: {
            reviewId: "review-1",
            submittedAt: "2026-08-20T12:00:00.000Z",
            referenceTrackLabel,
            candidateTrackLabel: referenceTrackLabel === "A" ? "B" : "A",
            machineAdvisoryRiskFlags: [],
            resolvedModel: "private-model",
            assessmentDigest: "a".repeat(64),
          },
          sourceTrack: {
            label: "SOURCE",
            contentId: "source-1",
            mediaType: "text/vtt",
          },
          trackA: {
            label: "A",
            contentId: "track-a-1",
            mediaType: "text/vtt",
          },
          trackB: {
            label: "B",
            contentId: "track-b-1",
            mediaType: "text/vtt",
          },
        }).success,
      ).toBe(false)
    },
  )

  it("obtains fresh, surface-specific bearer tokens and fresh assertions", async () => {
    let assertionNumber = 0
    const graphqlBearer = vi.fn(async () => `graphql-token-${assertionNumber}`)
    const oauthBearer = vi.fn(async () => `oauth-token-${assertionNumber}`)
    const fetchMock = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const rawUrl = String(url)
        if (rawUrl.endsWith("/api/manager/session")) {
          assertionNumber += 1
          const body = JSON.parse(String(init?.body))
          return new Response(
            JSON.stringify(
              body.reviewerAssertionRequest
                ? { reviewerAssertion: `assertion-${assertionNumber}` }
                : { subtitleEvalDelegation: `assertion-${assertionNumber}` },
            ),
          )
        }
        const body = JSON.parse(String(init?.body))
        if (String(body.query).includes("ReviewerAssignments")) {
          return new Response(
            JSON.stringify({
              data: {
                managerSubtitleEvalReviewerAssignments: {
                  nodes: [],
                  nextCursor: null,
                },
              },
            }),
          )
        }
        if (String(body.query).includes("ReviewerAssignment(")) {
          return new Response(
            JSON.stringify({
              data: { managerSubtitleEvalReviewerAssignment: null },
            }),
          )
        }
        return new Response(
          JSON.stringify({
            data: {
              submitManagerSubtitleEvalReview: {
                id: "review-1",
                status: "SUBMITTED",
                digest: "d".repeat(64),
                replayed: false,
              },
            },
          }),
        )
      },
    )
    const fetchImpl = fetchMock as typeof fetch
    const client = new SubtitleLabAdminClient({
      graphqlUrl: "https://admin.example/api/graphql",
      graphqlBearer,
      oauthBearer,
      fetchImpl,
    })
    const review = {
      assignmentId: "assignment-1",
      idempotencyKey: "review-attempt-1",
      rubricVersion: 1,
      trackAssessments: {
        trackA: {
          meaningAccuracyScore: 5,
          naturalnessScore: 4,
          timingReadabilityScore: 4,
          issueCodes: [],
          criticalMeaningLoss: false,
          criticalHarmful: false,
          criticalScriptureRisk: false,
        },
        trackB: {
          meaningAccuracyScore: 3,
          naturalnessScore: 5,
          timingReadabilityScore: 2,
          issueCodes: ["TIMING" as const],
          criticalMeaningLoss: false,
          criticalHarmful: false,
          criticalScriptureRisk: false,
        },
      },
      verdict: "PASS" as const,
      corrections: [],
    }

    await client.reviewerQueue(session, 10)
    await client.reviewerDetail(session, "assignment-1")
    await client.submitReview(session, review)

    expect(oauthBearer).toHaveBeenCalledTimes(3)
    expect(graphqlBearer).toHaveBeenCalledTimes(3)
    expect(oauthBearer).toHaveBeenCalledWith(
      "https://admin.example/api/manager/session",
    )
    expect(graphqlBearer).toHaveBeenCalledWith(
      "https://admin.example/api/graphql",
    )
    const sessionRequests = fetchMock.mock.calls
      .filter((call) => String(call[0]).endsWith("/api/manager/session"))
      .map((call) => JSON.parse(String(call[1]?.body)) as SessionExchangeBody)
    expect(
      new Set(
        sessionRequests.map(
          (body) =>
            body.reviewerAssertionRequest?.requestId ??
            body.subtitleEvalDelegationRequest?.requestId,
        ),
      ).size,
    ).toBe(3)
    expect(proofMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "REVIEWER_QUEUE",
        method: "GET",
        bodyDigest: canonicalDigest({ limit: 10, after: null }),
      }),
    )
    expect(proofMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentId: "assignment-1",
        method: "POST",
        bodyDigest: canonicalReviewSubmissionDigest(
          normalizeReviewSubmission(review),
        ),
      }),
    )
    const submittedVariables = fetchMock.mock.calls
      .map((call) => {
        try {
          return (
            JSON.parse(String(call[1]?.body)) as {
              variables?: GraphqlVariables
            }
          ).variables
        } catch {
          return undefined
        }
      })
      .find((variables) => variables?.input?.rubricVersion === 1)
    expect(submittedVariables?.input).toMatchObject({
      trackAssessments: {
        trackA: { scriptureTheologyScore: null },
        trackB: { scriptureTheologyScore: null },
      },
      questionableTrack: null,
      notes: null,
      supersedesReviewId: null,
    })
    expect(submittedVariables?.input).not.toHaveProperty("meaningAccuracyScore")
    expect(submittedVariables?.input).not.toHaveProperty("issueCodes")
    expect(submittedVariables?.input).not.toHaveProperty("criticalMeaningLoss")
    expect(JSON.stringify(submittedVariables?.input)).not.toMatch(
      /presentationSeed|referenceTrack|candidateTrack|provenance/i,
    )
  })

  it("replays the same assignment idempotency request after a lost response", async () => {
    let graphqlAttempts = 0
    let delegationAttempts = 0
    const graphqlBodies: Array<{
      variables?: { input?: Record<string, unknown> }
    }> = []
    const fetchImpl = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).endsWith("/api/manager/session")) {
          delegationAttempts += 1
          return new Response(
            JSON.stringify({
              subtitleEvalDelegation: `delegation-${delegationAttempts}`,
            }),
          )
        }

        graphqlAttempts += 1
        graphqlBodies.push(JSON.parse(String(init?.body)))
        if (graphqlAttempts === 1) {
          throw new TypeError("connection reset after Admin committed")
        }
        return Response.json({
          data: {
            createManagerSubtitleEvalAssignment: {
              id: "assignment-1",
              status: "ASSIGNED",
              digest: "d".repeat(64),
              replayed: true,
            },
          },
        })
      },
    ) as typeof fetch
    const client = new SubtitleLabAdminClient({
      graphqlUrl: "https://admin.example/api/graphql",
      graphqlBearer: "manager-backend-token",
      oauthBearer: "oauth-service-token",
      fetchImpl,
    })
    const assignment = {
      idempotencyKey: "assignment-request-1",
      runCellId: "run-cell-1",
      reviewerMembershipId: "membership-1",
      kind: "STANDARD" as const,
      specialistDimension: null,
    }

    await expect(client.createAssignment(session, assignment)).rejects.toThrow(
      "connection reset",
    )
    await expect(client.createAssignment(session, assignment)).resolves.toEqual(
      expect.objectContaining({ id: "assignment-1", replayed: true }),
    )

    expect(graphqlBodies).toHaveLength(2)
    expect(
      graphqlBodies.map(({ variables }) => {
        return Object.fromEntries(
          Object.entries(variables?.input ?? {}).filter(
            ([key]) => key !== "assertion",
          ),
        )
      }),
    ).toEqual([assignment, assignment])
    expect(proofMock).toHaveBeenCalledTimes(2)
    expect(proofMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        operation: "CREATE_ASSIGNMENT",
        bodyDigest: canonicalDigest(assignment),
      }),
    )
    expect(proofMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        operation: "CREATE_ASSIGNMENT",
        bodyDigest: canonicalDigest(assignment),
      }),
    )
  })

  it("keeps Admin GraphQL errors generic and does not leak credentials", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            errors: [
              {
                message:
                  "assertion=secret-assertion oauth=secret-oauth graphql=secret-graphql",
              },
            ],
          }),
        ),
    ) as typeof fetch
    const client = new SubtitleLabAdminClient({
      graphqlUrl: "https://admin.example/api/graphql",
      graphqlBearer: "secret-graphql",
      oauthBearer: "secret-oauth",
      fetchImpl,
    })

    const error = await client.claimCell("cell-1", 60).catch((value) => value)
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).toBe("Error: Admin GraphQL request failed.")
    expect(String(error)).not.toMatch(/secret/i)
  })

  it("rejects malformed and oversized GraphQL responses before parsing", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("not-json"))
      .mockResolvedValueOnce(
        new Response("{}", {
          headers: { "content-length": String(4 * 1024 * 1024 + 1) },
        }),
      )
    const client = new SubtitleLabAdminClient({
      graphqlUrl: "https://admin.example/api/graphql",
      graphqlBearer: "backend",
      oauthBearer: "oauth",
      fetchImpl: fetchImpl as typeof fetch,
    })

    await expect(client.claimCell("cell-1", 60)).rejects.toThrow()
    await expect(client.claimCell("cell-1", 60)).rejects.toThrow(
      /byte ceiling/i,
    )
  })

  it.each([
    [{ byteLength: String(3 * 1024 * 1024 + 1) }],
    [{ sha256: "not-a-digest" }],
  ])("rejects an invalid locator identity", async (override) => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ reviewerAssertion: "admin-assertion" })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            locator: {
              objectKey: `subtitle-eval/v1/candidate/${"a".repeat(64)}.vtt`,
              mediaType: "text/vtt",
              byteLength: "7",
              sha256: "a".repeat(64),
              ...override,
            },
          }),
        ),
      )
    const client = new SubtitleLabAdminClient({
      graphqlUrl: "https://admin.example/api/graphql",
      graphqlBearer: "backend",
      oauthBearer: "oauth",
      fetchImpl,
    })

    await expect(
      client.reviewerTrackLocator(session, "assignment-1", "b".repeat(64)),
    ).resolves.toBeNull()
  })
})
