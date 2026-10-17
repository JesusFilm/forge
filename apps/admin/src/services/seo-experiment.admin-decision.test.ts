import { createHash } from "node:crypto"

import { Prisma } from "@prisma/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SeoAssertionReplayError } from "@/auth/seo-assertion-ledger"
import { ForbiddenError } from "./errors"
import {
  ADMIN_INTERACTIVE_SEO_DECISION_AUDIENCE,
  ADMIN_INTERACTIVE_SEO_DECISION_KEY_ID,
  SeoExperimentService,
  SeoLedgerConflictError,
} from "./seo-experiment.service"
import {
  SeoTargetConflictError,
  SeoTargetService,
  SeoTargetStaleError,
} from "./seo-target.service"

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const PAYLOAD_DIGEST = "a".repeat(64)

type TargetType = "VideoLocale" | "Engineering"

function versionRow({
  targetType = "VideoLocale",
  status = "PROPOSED",
  currentVersion = 2,
  expiresAt = new Date(Date.now() + 60_000),
  decision = null,
}: {
  targetType?: TargetType
  status?: string
  currentVersion?: number
  expiresAt?: Date
  decision?: { id: string; action: "APPROVE" | "REJECT" } | null
} = {}) {
  return {
    id: "version-2",
    proposalId: "proposal-1",
    version: 2,
    payloadDigest: PAYLOAD_DIGEST,
    payload: {},
    engineeringBrief:
      targetType === "Engineering"
        ? {
            ticketOnly: false,
            deploymentProbe: {
              type: "page_text_hash",
              expectedValue: "d".repeat(64),
            },
          }
        : null,
    preChangeSnapshot: { deployed: false },
    treatmentSnapshot: { deployed: true },
    decision,
    materialization: null,
    ticketOutbox: null,
    proposal: {
      id: "proposal-1",
      currentVersion,
      status,
      expiresAt,
      semanticConflictKey: "watch:jesus:en:title",
      targetType,
      targetId: targetType === "Engineering" ? null : "video-locale-1",
    },
  }
}

/**
 * A strict transaction double: every model the decision core may touch is
 * listed. Any other model access (for example a canonical `videoLocale` or
 * `experienceLocale` write that would mean direct publishing) throws.
 */
function ledgerTx({
  version = versionRow(),
  overlappingProposals = [] as Array<{ id: string }>,
  liveRole = "ADMIN" as string | null,
  nonceCreate = vi.fn(async () => ({})),
}: {
  version?: ReturnType<typeof versionRow> | null
  overlappingProposals?: Array<{ id: string }>
  liveRole?: string | null
  nonceCreate?: ReturnType<typeof vi.fn>
} = {}) {
  const models = {
    user: {
      findUnique: vi.fn(async () =>
        liveRole === null ? null : { id: "admin-user", role: liveRole },
      ),
    },
    seoApprovalNonce: { create: nonceCreate },
    seoProposalVersion: { findUnique: vi.fn(async () => version) },
    seoProposal: {
      findMany: vi.fn(async () => overlappingProposals),
      update: vi.fn(async () => ({})),
    },
    seoExperiment: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: "experiment-1" })),
    },
    seoDecision: { create: vi.fn(async () => ({ id: "decision-1" })) },
    seoTicketOutbox: { create: vi.fn(async () => ({ id: "outbox-1" })) },
    seoProposalMaterialization: { create: vi.fn(async () => ({})) },
  }
  const touched = new Set<string>()
  const tx = new Proxy(models, {
    get(target, property: string) {
      touched.add(property)
      if (!(property in target)) {
        throw new Error(`unexpected transaction model access: ${property}`)
      }
      return target[property as keyof typeof target]
    },
  })
  return { tx, models, touched }
}

function serviceFor(tx: unknown) {
  const transaction = vi.fn(
    async (callback: (client: unknown) => unknown, _options?: unknown) =>
      callback(tx),
  )
  return {
    service: new SeoExperimentService({ $transaction: transaction } as never),
    transaction,
  }
}

function managerAssertion(
  overrides: Partial<{
    action: "approve" | "reject"
    version: number
    payloadDigest: string
    nonceHash: string
  }> = {},
) {
  return {
    keyId: "approval-key",
    environment: "test",
    audience: "forge-admin-seo-approval" as const,
    actorId: "admin-user",
    action: overrides.action ?? ("approve" as const),
    proposalId: "proposal-1",
    version: overrides.version ?? 2,
    payloadDigest: overrides.payloadDigest ?? PAYLOAD_DIGEST,
    nonceHash: overrides.nonceHash ?? "b".repeat(64),
    expiresAt: new Date(Date.now() + 60_000),
  }
}

function mockDraft() {
  return vi
    .spyOn(SeoTargetService.prototype, "materializeEditorialDraft")
    .mockResolvedValue({
      revisionId: "revision-1",
      editorPath: "/dashboard/videos/video-1",
      preChangeSnapshot: { title: "Before" },
      treatmentSnapshot: { title: "After" },
      preChangeHash: "1".repeat(64),
      treatmentHash: "2".repeat(64),
      expectedActivationHash: "3".repeat(64),
    })
}

function adminInput(
  overrides: Partial<{
    expectedAction: "approve" | "reject"
    version: number
    payloadDigest: string
    overlapAcknowledged: boolean
    reason: string | null
  }> = {},
) {
  return {
    actorId: "admin-user",
    proposalId: "proposal-1",
    version: overrides.version ?? 2,
    payloadDigest: overrides.payloadDigest ?? PAYLOAD_DIGEST,
    expectedAction: overrides.expectedAction ?? ("approve" as const),
    overlapAcknowledged: overrides.overlapAcknowledged ?? false,
    reason: overrides.reason ?? null,
  }
}

function writesOf(models: ReturnType<typeof ledgerTx>["models"]) {
  return {
    decision: models.seoDecision.create.mock.calls,
    materialization: models.seoProposalMaterialization.create.mock.calls,
    experiment: models.seoExperiment.create.mock.calls,
    outbox: models.seoTicketOutbox.create.mock.calls,
    proposal: models.seoProposal.update.mock.calls,
  }
}

describe("SEO proposal decision — Manager signed path is preserved", () => {
  it("keeps the Manager permission gate and assertion action check", async () => {
    const { tx } = ledgerTx()
    const { service, transaction } = serviceFor(tx)

    await expect(
      service.decideProposal({
        user: null,
        assertion: managerAssertion(),
        expectedAction: "approve",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      service.decideProposal({
        user: { id: null, role: "MANAGER_BACKEND" },
        assertion: managerAssertion({ action: "reject" }),
        expectedAction: "approve",
      }),
    ).rejects.toMatchObject({ code: "assertion_mismatch" })
    expect(transaction).not.toHaveBeenCalled()
  })

  it("records the verified Manager assertion as the nonce audit row and never reads the Admin user role", async () => {
    mockDraft()
    const { tx, models, touched } = ledgerTx()
    const { service, transaction } = serviceFor(tx)

    const result = await service.decideProposal({
      user: { id: null, role: "MANAGER_BACKEND" },
      assertion: managerAssertion(),
      expectedAction: "approve",
    })

    expect(result).toMatchObject({
      status: "APPROVED",
      draftRevisionId: "revision-1",
    })
    expect(models.seoApprovalNonce.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        nonceHash: "b".repeat(64),
        keyId: "approval-key",
        audience: "forge-admin-seo-approval",
        actorId: "admin-user",
        action: "APPROVE",
        proposalVersionId: "version-2",
      }),
    })
    expect(touched.has("user")).toBe(false)
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    })
  })
})

describe("SEO proposal decision — Admin interactive path", () => {
  it("creates the same canonical editorial rows and result as the Manager path", async () => {
    mockDraft()
    const manager = ledgerTx()
    await serviceFor(manager.tx).service.decideProposal({
      user: { id: null, role: "MANAGER_BACKEND" },
      assertion: managerAssertion(),
      expectedAction: "approve",
    })
    const managerResult = await serviceFor(
      ledgerTx().tx,
    ).service.decideProposal({
      user: { id: null, role: "MANAGER_BACKEND" },
      assertion: managerAssertion(),
      expectedAction: "approve",
    })

    const admin = ledgerTx()
    const { service, transaction } = serviceFor(admin.tx)
    const adminResult = await service.decideProposalAsAdmin(adminInput())

    expect(adminResult).toEqual(managerResult)
    expect(writesOf(admin.models)).toEqual(writesOf(manager.models))
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    })
  })

  it("creates the same engineering ticket outbox rows as the Manager path", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() })
    const engineering = versionRow({ targetType: "Engineering" })
    const manager = ledgerTx({ version: engineering })
    const managerResult = await serviceFor(manager.tx).service.decideProposal({
      user: { id: null, role: "MANAGER_BACKEND" },
      assertion: managerAssertion(),
      expectedAction: "approve",
    })
    const admin = ledgerTx({
      version: versionRow({ targetType: "Engineering" }),
    })
    const adminResult = await serviceFor(
      admin.tx,
    ).service.decideProposalAsAdmin(adminInput())

    expect(adminResult).toEqual(managerResult)
    expect(adminResult).toMatchObject({
      status: "APPROVED",
      ticketOutboxId: "outbox-1",
      draftRevisionId: null,
    })
    expect(writesOf(admin.models)).toEqual(writesOf(manager.models))
  })

  it("creates the same rejection rows as the Manager path", async () => {
    const manager = ledgerTx()
    await serviceFor(manager.tx).service.decideProposal({
      user: { id: null, role: "MANAGER_BACKEND" },
      assertion: managerAssertion({ action: "reject" }),
      expectedAction: "reject",
      reason: "Off-brand title",
    })
    const admin = ledgerTx()
    const result = await serviceFor(admin.tx).service.decideProposalAsAdmin(
      adminInput({ expectedAction: "reject", reason: "Off-brand title" }),
    )

    expect(result).toMatchObject({
      status: "REJECTED",
      decisionId: "decision-1",
    })
    expect(writesOf(admin.models)).toEqual(writesOf(manager.models))
    expect(admin.models.seoDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "REJECT",
        actorId: "admin-user",
        reason: "Off-brand title",
      }),
    })
  })

  it("records a server-generated single-use nonce with a distinct audit key and audience", async () => {
    mockDraft()
    const { tx, models } = ledgerTx()
    const { service } = serviceFor(tx)
    const nonce = "server-generated-nonce-value-0001"

    await service.decideProposalAsAdmin(adminInput(), {
      generateNonce: () => nonce,
    })

    const data = models.seoApprovalNonce.create.mock.calls[0]?.[0]?.data
    expect(data).toMatchObject({
      nonceHash: createHash("sha256").update(nonce).digest("hex"),
      keyId: ADMIN_INTERACTIVE_SEO_DECISION_KEY_ID,
      audience: ADMIN_INTERACTIVE_SEO_DECISION_AUDIENCE,
      actorId: "admin-user",
      action: "APPROVE",
      proposalVersionId: "version-2",
    })
    expect(ADMIN_INTERACTIVE_SEO_DECISION_KEY_ID).toBe("admin-interactive-v1")
    expect(ADMIN_INTERACTIVE_SEO_DECISION_AUDIENCE).not.toBe(
      "forge-admin-seo-approval",
    )
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(data.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 120_000)
  })

  it("generates a fresh cryptographically random nonce for each decision", async () => {
    mockDraft()
    const first = ledgerTx()
    const second = ledgerTx()
    await serviceFor(first.tx).service.decideProposalAsAdmin(adminInput())
    await serviceFor(second.tx).service.decideProposalAsAdmin(adminInput())

    const hashOf = (models: ReturnType<typeof ledgerTx>["models"]) =>
      models.seoApprovalNonce.create.mock.calls[0]?.[0]?.data.nonceHash
    expect(hashOf(first.models)).toMatch(/^[a-f0-9]{64}$/)
    expect(hashOf(first.models)).not.toBe(hashOf(second.models))
  })

  it("rejects a replayed nonce before any decision row is written", async () => {
    const nonceCreate = vi.fn(async () => {
      throw new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "test",
      })
    })
    const { tx, models } = ledgerTx({ nonceCreate })

    await expect(
      serviceFor(tx).service.decideProposalAsAdmin(adminInput(), {
        generateNonce: () => "replayed-nonce-value-000000001",
      }),
    ).rejects.toBeInstanceOf(SeoAssertionReplayError)
    expect(models.seoDecision.create).not.toHaveBeenCalled()
  })

  it.each([
    ["version", { version: 3 }, null],
    ["payload digest", { payloadDigest: "f".repeat(64) }, versionRow()],
  ] as const)(
    "rejects a %s mismatch without consuming a nonce",
    async (_label, overrides, storedVersion) => {
      const { tx, models } = ledgerTx({ version: storedVersion })

      await expect(
        serviceFor(tx).service.decideProposalAsAdmin(adminInput(overrides)),
      ).rejects.toMatchObject({ code: "assertion_mismatch" })
      expect(models.seoApprovalNonce.create).not.toHaveBeenCalled()
      expect(models.seoDecision.create).not.toHaveBeenCalled()
    },
  )

  it("denies an actor whose live database role is no longer ADMIN", async () => {
    for (const liveRole of ["EDITOR", "VIEWER", null]) {
      const { tx, models } = ledgerTx({ liveRole })
      await expect(
        serviceFor(tx).service.decideProposalAsAdmin(adminInput()),
      ).rejects.toBeInstanceOf(ForbiddenError)
      expect(models.seoApprovalNonce.create).not.toHaveBeenCalled()
      expect(models.seoDecision.create).not.toHaveBeenCalled()
    }
  })

  it("requires a decline reason of at least three characters", async () => {
    for (const reason of [null, "", "  ", " no "]) {
      const { service, transaction } = serviceFor(ledgerTx().tx)
      await expect(
        service.decideProposalAsAdmin(
          adminInput({ expectedAction: "reject", reason }),
        ),
      ).rejects.toMatchObject({ code: "reason_required" })
      expect(transaction).not.toHaveBeenCalled()
    }
  })

  it("rejects malformed identity before opening a transaction", async () => {
    const { tx } = ledgerTx()
    const { service, transaction } = serviceFor(tx)
    for (const bad of [
      { ...adminInput(), version: 0 },
      { ...adminInput(), payloadDigest: "not-a-digest" },
      { ...adminInput(), proposalId: "" },
      { ...adminInput(), actorId: "" },
    ]) {
      await expect(service.decideProposalAsAdmin(bad)).rejects.toBeInstanceOf(
        SeoLedgerConflictError,
      )
    }
    expect(transaction).not.toHaveBeenCalled()
  })

  it("requires overlap acknowledgement and accepts it when given", async () => {
    mockDraft()
    const unacknowledged = ledgerTx({
      overlappingProposals: [{ id: "proposal-other" }],
    })
    const conflict = await serviceFor(
      unacknowledged.tx,
    ).service.decideProposalAsAdmin(adminInput())
    expect(conflict).toMatchObject({ status: "CONFLICT", decisionId: null })
    expect(unacknowledged.models.seoDecision.create).not.toHaveBeenCalled()

    const acknowledged = ledgerTx({
      overlappingProposals: [{ id: "proposal-other" }],
    })
    const approved = await serviceFor(
      acknowledged.tx,
    ).service.decideProposalAsAdmin(adminInput({ overlapAcknowledged: true }))
    expect(approved).toMatchObject({ status: "APPROVED" })
    expect(acknowledged.models.seoDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        overlapAcknowledged: true,
        overlapCount: 1,
        confounders: ["overlapping_change"],
      }),
    })
  })

  it("returns the existing decision when the proposal was already decided", async () => {
    const { tx, models } = ledgerTx({
      version: versionRow({
        status: "REJECTED",
        decision: { id: "decision-0", action: "REJECT" },
      }),
    })
    const result =
      await serviceFor(tx).service.decideProposalAsAdmin(adminInput())
    expect(result).toMatchObject({
      status: "REJECTED",
      decisionId: "decision-0",
    })
    expect(models.seoDecision.create).not.toHaveBeenCalled()
  })

  it("reports a changed proposal as already decided", async () => {
    const { tx } = ledgerTx({
      version: versionRow({ currentVersion: 3 }),
    })
    await expect(
      serviceFor(tx).service.decideProposalAsAdmin(adminInput()),
    ).resolves.toMatchObject({ status: "ALREADY_DECIDED" })
  })

  it("expires a proposal past its deadline", async () => {
    const { tx, models } = ledgerTx({
      version: versionRow({ expiresAt: new Date(Date.now() - 1_000) }),
    })
    await expect(
      serviceFor(tx).service.decideProposalAsAdmin(adminInput()),
    ).resolves.toMatchObject({ status: "EXPIRED" })
    expect(models.seoProposal.update).toHaveBeenCalledWith({
      where: { id: "proposal-1" },
      data: { status: "EXPIRED" },
    })
    expect(models.seoDecision.create).not.toHaveBeenCalled()
  })

  it("marks the proposal stale when the canonical target changed", async () => {
    vi.spyOn(
      SeoTargetService.prototype,
      "materializeEditorialDraft",
    ).mockRejectedValue(new SeoTargetStaleError())
    const { tx, models } = ledgerTx()
    await expect(
      serviceFor(tx).service.decideProposalAsAdmin(adminInput()),
    ).resolves.toMatchObject({ status: "STALE" })
    expect(models.seoProposal.update).toHaveBeenCalledWith({
      where: { id: "proposal-1" },
      data: { status: "STALE" },
    })
  })

  it("reports an existing draft as a conflict", async () => {
    vi.spyOn(
      SeoTargetService.prototype,
      "materializeEditorialDraft",
    ).mockRejectedValue(new SeoTargetConflictError())
    const { tx } = ledgerTx()
    await expect(
      serviceFor(tx).service.decideProposalAsAdmin(adminInput()),
    ).resolves.toMatchObject({ status: "CONFLICT" })
  })

  it("never publishes: an approval only creates a draft, a decision, and an experiment", async () => {
    const draft = mockDraft()
    const { tx, models, touched } = ledgerTx()

    const result =
      await serviceFor(tx).service.decideProposalAsAdmin(adminInput())

    expect(result.message).toBe(
      "Editorial draft created. Canonical content is unchanged.",
    )
    expect(draft).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "admin-user" }),
    )
    expect([...touched].sort()).toEqual(
      [
        "seoApprovalNonce",
        "seoDecision",
        "seoExperiment",
        "seoProposal",
        "seoProposalMaterialization",
        "seoProposalVersion",
        "user",
      ].sort(),
    )
    expect(models.seoProposal.update).toHaveBeenCalledWith({
      where: { id: "proposal-1" },
      data: { status: "MATERIALIZED" },
    })
  })
})

describe("SEO proposal Admin confirmation read", () => {
  function readPrisma({
    liveRole = "ADMIN",
    version = {
      ...versionRow(),
      intent: "Clarify the title",
      expectedOutcome: "More clicks from search",
      risk: "low",
      verificationPlan: "Compare CTR",
      rollbackPlan: "Discard the draft",
      affectedFields: ["title"],
      caveats: [],
      createdAt: new Date("2026-10-15T00:00:00.000Z"),
      proposal: {
        ...versionRow().proposal,
        lane: "EDITORIAL",
        canonicalUrl: "https://www.jesusfilm.org/watch/jesus.html/english.html",
        locale: "en",
      },
    } as Record<string, unknown> | null,
  }: { liveRole?: string; version?: Record<string, unknown> | null } = {}) {
    return {
      user: {
        findUnique: vi.fn(async () => ({ id: "admin-user", role: liveRole })),
      },
      seoProposalVersion: { findUnique: vi.fn(async () => version) },
      seoProposal: { count: vi.fn(async () => 1) },
      seoExperiment: { count: vi.fn(async () => 0) },
    }
  }

  it("returns immutable proposal details and what Apply creates", async () => {
    const prisma = readPrisma()
    const view = await new SeoExperimentService(
      prisma as never,
    ).readProposalForAdminConfirmation({
      actorId: "admin-user",
      proposalId: "proposal-1",
      version: 2,
    })
    expect(view).toMatchObject({
      proposalId: "proposal-1",
      version: 2,
      payloadDigest: PAYLOAD_DIGEST,
      currentVersion: 2,
      proposalStatus: "PROPOSED",
      applyCreates: "editorial_draft",
      overlapCount: 1,
      intent: "Clarify the title",
      decision: null,
    })
    expect(view).not.toHaveProperty("payload")
    expect(view).not.toHaveProperty("preChangeSnapshot")
  })

  it("denies a non-ADMIN live role", async () => {
    await expect(
      new SeoExperimentService(
        readPrisma({ liveRole: "EDITOR" }) as never,
      ).readProposalForAdminConfirmation({
        actorId: "admin-user",
        proposalId: "proposal-1",
        version: 2,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("returns null for an unknown proposal version", async () => {
    await expect(
      new SeoExperimentService(
        readPrisma({ version: null }) as never,
      ).readProposalForAdminConfirmation({
        actorId: "admin-user",
        proposalId: "proposal-1",
        version: 9,
      }),
    ).resolves.toBeNull()
  })
})
