import { beforeEach, describe, expect, it, vi } from "vitest"

const userFindUnique = vi.fn()
const userUpdate = vi.fn()
const isValidManagerServiceToken = vi.fn()
const verifyManagerReviewerSessionProof = vi.fn()
const mintSubtitleReviewAssertion = vi.fn()
const mintSubtitleEvalDelegation = vi.fn()
const assertReviewerAssignmentAccess = vi.fn()
const assertionNonceFindUnique = vi.fn()
const assertionNonceCreate = vi.fn()
const delegationNonceCreateMany = vi.fn()

vi.mock("@/auth/manager-service-token", () => ({
  isValidManagerServiceToken: (...args: unknown[]) =>
    isValidManagerServiceToken(...args),
}))
vi.mock("@/auth/manager-reviewer-session-proof", () => ({
  verifyManagerReviewerSessionProof: (...args: unknown[]) =>
    verifyManagerReviewerSessionProof(...args),
}))
vi.mock("@/auth/subtitle-review-assertion", () => ({
  mintSubtitleReviewAssertion: (...args: unknown[]) =>
    mintSubtitleReviewAssertion(...args),
}))
vi.mock("@/auth/subtitle-eval-delegation-assertion", async () => {
  const { z } = await import("zod")
  return {
    SubtitleEvalDelegatedOperation: z.enum([
      "IMPORT_CORPUS",
      "APPROVE_CORPUS",
      "CREATE_RUN",
      "CREATE_ASSIGNMENT",
      "ASSIGN_SPECIALIST",
      "DISPOSITION_REFERENCE_ISSUE",
      "CREATE_COMPARISON",
      "APPEND_NARRATIVE",
      "RECOVER_RUN",
      "REVIEWER_QUEUE",
    ]),
    mintSubtitleEvalDelegation: (...args: unknown[]) =>
      mintSubtitleEvalDelegation(...args),
  }
})
vi.mock("@/services/subtitle-eval.service", () => ({
  SubtitleEvalService: class {
    assertReviewerAssignmentAccess(...args: unknown[]) {
      return assertReviewerAssignmentAccess(...args)
    }
  },
}))

vi.mock("@/db/client", () => ({
  prisma: {
    $transaction: async (
      callback: (tx: {
        subtitleEvalAssertionNonce: {
          findUnique: typeof assertionNonceFindUnique
          create: typeof assertionNonceCreate
        }
        subtitleEvalDelegationNonce: {
          createMany: typeof delegationNonceCreateMany
        }
      }) => unknown,
    ) =>
      callback({
        subtitleEvalAssertionNonce: {
          findUnique: assertionNonceFindUnique,
          create: assertionNonceCreate,
        },
        subtitleEvalDelegationNonce: {
          createMany: delegationNonceCreateMany,
        },
      }),
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
      update: (...args: unknown[]) => userUpdate(...args),
    },
  },
}))

describe("POST /api/manager/session", () => {
  beforeEach(() => {
    userFindUnique.mockReset()
    userUpdate.mockReset()
    isValidManagerServiceToken.mockReset()
    verifyManagerReviewerSessionProof.mockReset()
    mintSubtitleReviewAssertion.mockReset()
    mintSubtitleEvalDelegation.mockReset()
    assertReviewerAssignmentAccess.mockReset()
    assertionNonceFindUnique.mockReset()
    assertionNonceCreate.mockReset()
    delegationNonceCreateMany.mockReset()
    isValidManagerServiceToken.mockResolvedValue(false)
    verifyManagerReviewerSessionProof.mockRejectedValue(
      new Error("proof missing"),
    )
    mintSubtitleReviewAssertion.mockResolvedValue("admin-review-assertion")
    mintSubtitleEvalDelegation.mockResolvedValue("admin-eval-delegation")
    assertReviewerAssignmentAccess.mockResolvedValue({})
    assertionNonceFindUnique.mockResolvedValue(null)
    assertionNonceCreate.mockResolvedValue({})
    delegationNonceCreateMany.mockResolvedValue({ count: 1 })
    vi.unstubAllEnvs()
    vi.resetModules()
    vi.stubEnv("DATABASE_URL", "postgresql://example.test/admin")
    vi.stubEnv("ADMIN_SESSION_SECRET", "admin-session-secret-change-me-000000")
    vi.stubEnv("AUTH_ISSUER_URL", "https://auth.jesusfilm.org")
    vi.stubEnv("AUTH_ADMIN_CLIENT_ID", "jfp_admin_local")
    vi.stubEnv("MANAGER_ADMIN_API_KEY", "manager-admin-key")
  })

  it("rejects requests without the Manager service bearer", async () => {
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3003/api/manager/session", {
        method: "POST",
        body: JSON.stringify({
          subject: "auth-user-123",
          email: "manager@example.com",
        }),
      }),
    )

    expect(response.status).toBe(403)
    expect(userFindUnique).not.toHaveBeenCalled()
  })

  it("rejects a declared body over the Manager route ceiling before user lookup", async () => {
    isValidManagerServiceToken.mockResolvedValue(true)
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3003/api/manager/session", {
        method: "POST",
        headers: {
          authorization: "Bearer manager-oauth-service-token",
          "content-type": "application/json",
          "content-length": String(32 * 1024 + 1),
        },
        body: JSON.stringify({ subject: "auth-user-123" }),
      }),
    )

    expect(response.status).toBe(400)
    expect(userFindUnique).not.toHaveBeenCalled()
  })

  it("returns an active operator membership by Auth subject", async () => {
    userFindUnique.mockResolvedValueOnce({
      id: "auth-user-123",
      email: "manager@example.com",
      name: "Manager User",
      managerMembership: {
        role: "OPERATOR",
        revokedAt: null,
        reviewerLanguageGrants: [],
      },
    })
    userUpdate.mockResolvedValueOnce({
      id: "auth-user-123",
      email: "manager@example.com",
      name: "Manager User",
      managerMembership: {
        role: "OPERATOR",
        revokedAt: null,
        reviewerLanguageGrants: [],
      },
    })

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3003/api/manager/session", {
        method: "POST",
        headers: {
          authorization: "Bearer manager-admin-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          subject: "auth-user-123",
          email: "manager@example.com",
          name: "Manager User",
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      allowed: true,
      user: {
        id: "auth-user-123",
        email: "manager@example.com",
        name: "Manager User",
      },
      managerRole: "OPERATOR",
      reviewerLanguageGrants: [],
    })
  })

  it("returns only active exact-language grants for a reviewer", async () => {
    const reviewer = {
      id: "auth-reviewer-123",
      email: "reviewer@example.com",
      name: "Spanish Reviewer",
      managerMembership: {
        role: "REVIEWER",
        revokedAt: null,
        reviewerLanguageGrants: [
          {
            id: "grant-es",
            languageId: "language-es",
            permittedRubricDimensions: [
              "MEANING_ACCURACY",
              "NATURALNESS",
              "TIMING_READABILITY",
              "SCRIPTURE_THEOLOGY",
            ],
            scriptureSpecialist: true,
            theologySpecialist: false,
            revokedAt: null,
            language: {
              id: "language-es",
              slug: "spanish-latin-america",
              bcp47: "es-419",
              deletedAt: null,
            },
          },
          {
            id: "grant-revoked",
            languageId: "language-es-other",
            permittedRubricDimensions: ["MEANING_ACCURACY"],
            scriptureSpecialist: false,
            theologySpecialist: false,
            revokedAt: new Date("2026-08-19T00:00:00.000Z"),
            language: {
              id: "language-es-other",
              slug: "spanish-spain",
              bcp47: "es-419",
              deletedAt: null,
            },
          },
        ],
      },
    }
    userFindUnique.mockResolvedValueOnce(reviewer)
    userUpdate.mockResolvedValueOnce(reviewer)

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3003/api/manager/session", {
        method: "POST",
        headers: {
          authorization: "Bearer manager-admin-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          subject: reviewer.id,
          email: reviewer.email,
          name: reviewer.name,
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      allowed: true,
      user: {
        id: reviewer.id,
        email: reviewer.email,
        name: reviewer.name,
      },
      managerRole: "REVIEWER",
      reviewerLanguageGrants: [
        {
          id: "grant-es",
          languageId: "language-es",
          languageSlug: "spanish-latin-america",
          languageBcp47: "es-419",
          permittedRubricDimensions: [
            "MEANING_ACCURACY",
            "NATURALNESS",
            "TIMING_READABILITY",
            "SCRIPTURE_THEOLOGY",
          ],
          specialistCapabilities: {
            scripture: true,
            theology: false,
          },
        },
      ],
    })
  })

  it("denies a reviewer when every exact-language grant is revoked", async () => {
    const reviewer = {
      id: "auth-reviewer-123",
      email: "reviewer@example.com",
      name: "Former Reviewer",
      managerMembership: {
        role: "REVIEWER",
        revokedAt: null,
        reviewerLanguageGrants: [
          {
            id: "grant-revoked",
            languageId: "language-es",
            permittedRubricDimensions: ["MEANING_ACCURACY"],
            scriptureSpecialist: false,
            theologySpecialist: false,
            revokedAt: new Date("2026-08-19T00:00:00.000Z"),
            language: {
              id: "language-es",
              slug: "spanish-latin-america",
              bcp47: "es-419",
              deletedAt: null,
            },
          },
        ],
      },
    }
    userFindUnique.mockResolvedValueOnce(reviewer)
    userUpdate.mockResolvedValueOnce(reviewer)

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3003/api/manager/session", {
        method: "POST",
        headers: {
          authorization: "Bearer manager-admin-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          subject: reviewer.id,
          email: reviewer.email,
        }),
      }),
    )

    await expect(response.json()).resolves.toEqual({ allowed: false })
  })

  it("preserves existing email verification when Auth omits the email claim", async () => {
    userFindUnique.mockResolvedValueOnce({
      id: "auth-user-123",
      email: "manager@example.com",
      name: "Manager User",
      managerMembership: {
        role: "OPERATOR",
        revokedAt: null,
        reviewerLanguageGrants: [],
      },
    })
    userUpdate.mockResolvedValueOnce({
      id: "auth-user-123",
      email: "manager@example.com",
      name: "Manager User",
      managerMembership: {
        role: "OPERATOR",
        revokedAt: null,
        reviewerLanguageGrants: [],
      },
    })

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3003/api/manager/session", {
        method: "POST",
        headers: {
          authorization: "Bearer manager-admin-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          subject: "auth-user-123",
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          email: "manager@example.com",
          name: "Manager User",
        },
      }),
    )
  })

  it("denies Admin users without active Manager membership", async () => {
    userFindUnique.mockResolvedValueOnce({
      id: "auth-user-123",
      email: "admin@example.com",
      name: "Admin User",
      managerMembership: null,
    })
    userUpdate.mockResolvedValueOnce({
      id: "auth-user-123",
      email: "admin@example.com",
      name: "Admin User",
      managerMembership: null,
    })

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3003/api/manager/session", {
        method: "POST",
        headers: {
          authorization: "Bearer manager-admin-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          subject: "auth-user-123",
          email: "admin@example.com",
        }),
      }),
    )

    await expect(response.json()).resolves.toEqual({ allowed: false })
  })

  it("denies Admin users with revoked Manager membership", async () => {
    userFindUnique.mockResolvedValueOnce({
      id: "auth-user-123",
      email: "manager@example.com",
      name: "Former Manager",
      managerMembership: {
        role: "OPERATOR",
        revokedAt: new Date("2026-05-20T00:00:00.000Z"),
        reviewerLanguageGrants: [],
      },
    })
    userUpdate.mockResolvedValueOnce({
      id: "auth-user-123",
      email: "manager@example.com",
      name: "Former Manager",
      managerMembership: {
        role: "OPERATOR",
        revokedAt: new Date("2026-05-20T00:00:00.000Z"),
        reviewerLanguageGrants: [],
      },
    })

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3003/api/manager/session", {
        method: "POST",
        headers: {
          authorization: "Bearer manager-admin-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          subject: "auth-user-123",
          email: "manager@example.com",
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ allowed: false })
  })

  it("does not let the legacy service bearer mint human evidence", async () => {
    const reviewer = activeReviewer()
    userFindUnique.mockResolvedValue(reviewer)
    userUpdate.mockResolvedValue(reviewer)
    verifyManagerReviewerSessionProof.mockResolvedValue(validSessionProof())

    const { POST } = await import("./route")
    const response = await POST(assertionRequest("manager-admin-key"))

    expect(response.status).toBe(403)
    expect(mintSubtitleReviewAssertion).not.toHaveBeenCalled()
  })

  it("rejects a proof whose actor, assignment, method, or body binding differs", async () => {
    const reviewer = activeReviewer()
    userFindUnique.mockResolvedValue(reviewer)
    userUpdate.mockResolvedValue(reviewer)
    isValidManagerServiceToken.mockResolvedValue(true)
    verifyManagerReviewerSessionProof.mockResolvedValue({
      ...validSessionProof(),
      bodyDigest: "b".repeat(64),
    })

    const { POST } = await import("./route")
    const response = await POST(assertionRequest("oauth-service-token"))

    expect(response.status).toBe(403)
    expect(assertReviewerAssignmentAccess).not.toHaveBeenCalled()
    expect(mintSubtitleReviewAssertion).not.toHaveBeenCalled()
  })

  it("rejects a replayed Manager session proof before minting another assertion", async () => {
    const reviewer = activeReviewer()
    userFindUnique.mockResolvedValue(reviewer)
    userUpdate.mockResolvedValue(reviewer)
    isValidManagerServiceToken.mockResolvedValue(true)
    verifyManagerReviewerSessionProof.mockResolvedValue(validSessionProof())
    assertionNonceFindUnique.mockResolvedValue({ nonceHash: "proof-nonce" })

    const { POST } = await import("./route")
    const response = await POST(assertionRequest("oauth-service-token"))

    expect(response.status).toBe(404)
    expect(mintSubtitleReviewAssertion).not.toHaveBeenCalled()
  })

  it("rechecks revoked or wrong assignments before minting", async () => {
    const reviewer = activeReviewer()
    userFindUnique.mockResolvedValue(reviewer)
    userUpdate.mockResolvedValue(reviewer)
    isValidManagerServiceToken.mockResolvedValue(true)
    verifyManagerReviewerSessionProof.mockResolvedValue(validSessionProof())
    assertReviewerAssignmentAccess.mockRejectedValue(
      new Error("assignment unavailable"),
    )

    const { POST } = await import("./route")
    const response = await POST(assertionRequest("oauth-service-token"))

    expect(response.status).toBe(404)
    expect(assertionNonceCreate).not.toHaveBeenCalled()
    expect(mintSubtitleReviewAssertion).not.toHaveBeenCalled()
  })

  it("mints only after OAuth, fresh session proof, nonce, and assignment checks", async () => {
    const reviewer = activeReviewer()
    userFindUnique.mockResolvedValue(reviewer)
    userUpdate.mockResolvedValue(reviewer)
    isValidManagerServiceToken.mockResolvedValue(true)
    verifyManagerReviewerSessionProof.mockResolvedValue(validSessionProof())

    const { POST } = await import("./route")
    const response = await POST(assertionRequest("oauth-service-token"))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      allowed: true,
      managerRole: "REVIEWER",
      reviewerAssertion: "admin-review-assertion",
    })
    expect(assertReviewerAssignmentAccess).toHaveBeenCalledWith(
      { actorId: "auth-reviewer-123", assignmentId: "assignment-1" },
      expect.any(Object),
    )
    expect(assertionNonceCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assignmentId: "assignment-1",
        actorId: "auth-reviewer-123",
      }),
    })
    expect(mintSubtitleReviewAssertion).toHaveBeenCalledWith({
      actorId: "auth-reviewer-123",
      assignmentId: "assignment-1",
      method: "POST",
      bodyDigest: "a".repeat(64),
      requestId: "request-1",
    })
    expect(isValidManagerServiceToken).toHaveBeenCalledWith(
      "Bearer oauth-service-token",
      "admin:manager-session:validate",
    )
  })

  it("does not mint an operator delegation from the legacy bearer alone", async () => {
    const operator = activeOperator()
    userFindUnique.mockResolvedValue(operator)
    userUpdate.mockResolvedValue(operator)
    verifyManagerReviewerSessionProof.mockResolvedValue(validOperatorProof())

    const { POST } = await import("./route")
    const response = await POST(operatorDelegationRequest("manager-admin-key"))

    expect(response.status).toBe(403)
    expect(mintSubtitleEvalDelegation).not.toHaveBeenCalled()
  })

  it("rejects an operator proof whose operation or body claim differs", async () => {
    const operator = activeOperator()
    userFindUnique.mockResolvedValue(operator)
    userUpdate.mockResolvedValue(operator)
    isValidManagerServiceToken.mockResolvedValue(true)
    verifyManagerReviewerSessionProof.mockResolvedValue({
      ...validOperatorProof(),
      operation: "APPROVE_CORPUS",
    })

    const { POST } = await import("./route")
    const response = await POST(operatorDelegationRequest("oauth-service"))

    expect(response.status).toBe(403)
    expect(delegationNonceCreateMany).not.toHaveBeenCalled()
  })

  it("rejects a replayed operator proof and mints only after fresh OAuth and membership checks", async () => {
    const operator = activeOperator()
    userFindUnique.mockResolvedValue(operator)
    userUpdate.mockResolvedValue(operator)
    isValidManagerServiceToken.mockResolvedValue(true)
    verifyManagerReviewerSessionProof.mockResolvedValue(validOperatorProof())
    delegationNonceCreateMany.mockResolvedValueOnce({ count: 0 })

    const { POST } = await import("./route")
    const replay = await POST(operatorDelegationRequest("oauth-service"))
    expect(replay.status).toBe(404)
    expect(mintSubtitleEvalDelegation).not.toHaveBeenCalled()

    delegationNonceCreateMany.mockResolvedValueOnce({ count: 1 })
    const success = await POST(operatorDelegationRequest("oauth-service"))
    expect(success.status).toBe(200)
    await expect(success.json()).resolves.toMatchObject({
      subtitleEvalDelegation: "admin-eval-delegation",
    })
    expect(mintSubtitleEvalDelegation).toHaveBeenCalledWith({
      actorId: "auth-operator-123",
      managerRole: "OPERATOR",
      operation: "CREATE_RUN",
      method: "POST",
      bodyDigest: "b".repeat(64),
      requestId: "request-1",
    })
  })
})

function activeReviewer() {
  return {
    id: "auth-reviewer-123",
    email: "reviewer@example.com",
    name: "Reviewer",
    managerMembership: {
      role: "REVIEWER",
      revokedAt: null,
      reviewerLanguageGrants: [
        {
          id: "grant-es",
          languageId: "language-es",
          permittedRubricDimensions: [
            "MEANING_ACCURACY",
            "NATURALNESS",
            "TIMING_READABILITY",
          ],
          scriptureSpecialist: false,
          theologySpecialist: false,
          revokedAt: null,
          language: {
            id: "language-es",
            slug: "spanish-latin-america",
            bcp47: "es-419",
            deletedAt: null,
          },
        },
      ],
    },
  }
}

function activeOperator() {
  return {
    id: "auth-operator-123",
    email: "operator@example.com",
    name: "Operator",
    managerMembership: {
      role: "OPERATOR",
      revokedAt: null,
      reviewerLanguageGrants: [],
    },
  }
}

function validSessionProof() {
  return {
    actorId: "auth-reviewer-123",
    authSubject: "auth-reviewer-123",
    assignmentId: "assignment-1",
    method: "POST",
    bodyDigest: "a".repeat(64),
    nonceHash: "proof-nonce",
    expiresAt: new Date("2026-08-20T12:02:00.000Z"),
  }
}

function assertionRequest(bearer: string) {
  return new Request("http://localhost:3003/api/manager/session", {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      subject: "auth-reviewer-123",
      email: "reviewer@example.com",
      reviewerAssertionRequest: {
        assignmentId: "assignment-1",
        method: "POST",
        bodyDigest: "a".repeat(64),
        requestId: "request-1",
        managerSessionProof: "manager-session-proof",
      },
    }),
  })
}

function validOperatorProof() {
  return {
    actorId: "auth-operator-123",
    authSubject: "auth-operator-123",
    operation: "CREATE_RUN",
    method: "POST",
    bodyDigest: "b".repeat(64),
    nonceHash: "operator-proof-nonce",
    expiresAt: new Date("2026-08-20T12:02:00.000Z"),
  }
}

function operatorDelegationRequest(bearer: string) {
  return new Request("http://localhost:3003/api/manager/session", {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      subject: "auth-operator-123",
      email: "operator@example.com",
      subtitleEvalDelegationRequest: {
        operation: "CREATE_RUN",
        method: "POST",
        bodyDigest: "b".repeat(64),
        requestId: "request-1",
        managerSessionProof: "manager-session-proof",
      },
    }),
  })
}
