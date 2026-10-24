import { NextResponse } from "next/server"
import { z } from "zod"

import { isValidManagerBearer } from "@/auth/manager-bearer"
import { verifyManagerReviewerSessionProof } from "@/auth/manager-reviewer-session-proof"
import { projectActiveReviewerLanguageGrants } from "@/auth/manager-reviewer-grants"
import { isValidManagerServiceToken } from "@/auth/manager-service-token"
import { mintSubtitleReviewAssertion } from "@/auth/subtitle-review-assertion"
import {
  mintSubtitleEvalDelegation,
  SubtitleEvalDelegatedOperation,
} from "@/auth/subtitle-eval-delegation-assertion"
import { prisma } from "@/db/client"
import { SubtitleEvalService } from "@/services/subtitle-eval.service"
import { readBoundedManagerJson } from "../route-utils"

const payloadSchema = z
  .object({
    subject: z.string().min(1),
    email: z.string().email().optional(),
    name: z.string().min(1).optional(),
    reviewerAssertionRequest: z
      .object({
        assignmentId: z.string().min(1).max(191),
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        bodyDigest: z.string().regex(/^[a-f0-9]{64}$/),
        requestId: z.string().min(1).max(191),
        managerSessionProof: z.string().min(1).max(16_384),
      })
      .strict()
      .optional(),
    subtitleEvalDelegationRequest: z
      .object({
        operation: SubtitleEvalDelegatedOperation,
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        bodyDigest: z.string().regex(/^[a-f0-9]{64}$/),
        requestId: z.string().min(1).max(191),
        managerSessionProof: z.string().min(1).max(16_384),
      })
      .strict()
      .optional(),
  })
  .refine(
    (value) =>
      !value.reviewerAssertionRequest || !value.subtitleEvalDelegationRequest,
  )

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization")
  const isOauthServiceAuthorized = await isValidManagerServiceToken(
    authorization,
    "admin:manager-session:validate",
  )
  const isAuthorized =
    isOauthServiceAuthorized || isValidManagerBearer(authorization)

  if (!isAuthorized) {
    return NextResponse.json(
      { error: "Manager service bearer token required" },
      { status: 403 },
    )
  }

  let rawBody: unknown
  try {
    rawBody = await readBoundedManagerJson(request)
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = payloadSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "subject is required and email must be valid when present" },
      { status: 400 },
    )
  }

  const user = await resolveManagerUser(parsed.data)
  if (!user?.managerMembership || user.managerMembership.revokedAt) {
    return NextResponse.json({ allowed: false })
  }

  const reviewerLanguageGrants = projectActiveReviewerLanguageGrants(
    user.managerMembership.reviewerLanguageGrants,
  )
  if (
    user.managerMembership.role === "REVIEWER" &&
    reviewerLanguageGrants.length === 0
  ) {
    return NextResponse.json({ allowed: false })
  }

  let reviewerAssertion: string | undefined
  if (parsed.data.reviewerAssertionRequest) {
    const assertionRequest = parsed.data.reviewerAssertionRequest
    let sessionProof
    try {
      sessionProof = await verifyManagerReviewerSessionProof(
        assertionRequest.managerSessionProof,
      )
    } catch {
      return NextResponse.json(
        { error: "Fresh reviewer proof required" },
        { status: 403 },
      )
    }
    if (
      !isOauthServiceAuthorized ||
      user.managerMembership.role !== "REVIEWER" ||
      sessionProof.authSubject !== parsed.data.subject ||
      sessionProof.actorId !== user.id ||
      sessionProof.assignmentId !== assertionRequest.assignmentId ||
      sessionProof.method !== assertionRequest.method ||
      sessionProof.bodyDigest !== assertionRequest.bodyDigest
    ) {
      return NextResponse.json(
        { error: "Fresh reviewer proof required" },
        { status: 403 },
      )
    }
    try {
      await prisma.$transaction(async (tx) => {
        await new SubtitleEvalService(prisma).assertReviewerAssignmentAccess(
          {
            actorId: user.id,
            assignmentId: assertionRequest.assignmentId,
          },
          tx,
        )
        const replay = await tx.subtitleEvalAssertionNonce.findUnique({
          where: { nonceHash: sessionProof.nonceHash },
        })
        if (replay) throw new Error("reviewer_session_proof_replayed")
        await tx.subtitleEvalAssertionNonce.create({
          data: {
            nonceHash: sessionProof.nonceHash,
            assignmentId: assertionRequest.assignmentId,
            actorId: user.id,
            expiresAt: sessionProof.expiresAt,
          },
        })
      })
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    reviewerAssertion = await mintSubtitleReviewAssertion({
      actorId: user.id,
      assignmentId: assertionRequest.assignmentId,
      method: assertionRequest.method,
      bodyDigest: assertionRequest.bodyDigest,
      requestId: assertionRequest.requestId,
    })
  }

  let subtitleEvalDelegation: string | undefined
  if (parsed.data.subtitleEvalDelegationRequest) {
    const delegationRequest = parsed.data.subtitleEvalDelegationRequest
    let sessionProof
    try {
      sessionProof = await verifyManagerReviewerSessionProof(
        delegationRequest.managerSessionProof,
      )
    } catch {
      return NextResponse.json(
        { error: "Fresh Manager session proof required" },
        { status: 403 },
      )
    }
    const roleAllowsOperation =
      delegationRequest.operation === "REVIEWER_QUEUE"
        ? user.managerMembership.role === "REVIEWER"
        : user.managerMembership.role === "OPERATOR"
    if (
      !isOauthServiceAuthorized ||
      !roleAllowsOperation ||
      sessionProof.authSubject !== parsed.data.subject ||
      sessionProof.actorId !== user.id ||
      sessionProof.operation !== delegationRequest.operation ||
      sessionProof.method !== delegationRequest.method ||
      sessionProof.bodyDigest !== delegationRequest.bodyDigest
    ) {
      return NextResponse.json(
        { error: "Fresh Manager session proof required" },
        { status: 403 },
      )
    }
    try {
      await prisma.$transaction(async (tx) => {
        const replay = await tx.subtitleEvalDelegationNonce.createMany({
          data: {
            nonceHash: sessionProof.nonceHash,
            actorId: user.id,
            operation: delegationRequest.operation,
            expiresAt: sessionProof.expiresAt,
            consumedAt: new Date(),
          },
          skipDuplicates: true,
        })
        if (replay.count !== 1) throw new Error("manager_proof_replayed")
      })
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    subtitleEvalDelegation = await mintSubtitleEvalDelegation({
      actorId: user.id,
      managerRole: user.managerMembership.role,
      operation: delegationRequest.operation,
      method: delegationRequest.method,
      bodyDigest: delegationRequest.bodyDigest,
      requestId: delegationRequest.requestId,
    })
  }

  return NextResponse.json({
    allowed: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    managerRole: user.managerMembership.role,
    reviewerLanguageGrants,
    ...(reviewerAssertion ? { reviewerAssertion } : {}),
    ...(subtitleEvalDelegation ? { subtitleEvalDelegation } : {}),
  })
}

async function resolveManagerUser({
  subject,
  email,
  name,
}: z.infer<typeof payloadSchema>) {
  const select = {
    id: true,
    email: true,
    name: true,
    managerMembership: {
      select: {
        role: true,
        revokedAt: true,
        reviewerLanguageGrants: {
          select: {
            id: true,
            languageId: true,
            permittedRubricDimensions: true,
            scriptureSpecialist: true,
            theologySpecialist: true,
            revokedAt: true,
            language: {
              select: {
                id: true,
                slug: true,
                bcp47: true,
                deletedAt: true,
              },
            },
          },
        },
      },
    },
  } as const

  const existingById = await prisma.user.findUnique({
    where: { id: subject },
    select,
  })

  if (existingById) {
    return prisma.user.update({
      where: { id: existingById.id },
      data: {
        email: email ?? existingById.email,
        name: name ?? existingById.name,
        ...(email ? { emailVerified: true } : {}),
      },
      select,
    })
  }

  if (!email) {
    return null
  }

  const existingByEmail = await prisma.user.findUnique({
    where: { email },
    select,
  })

  if (!existingByEmail) {
    return null
  }

  return prisma.user.update({
    where: { id: existingByEmail.id },
    data: {
      name: name ?? existingByEmail.name,
      emailVerified: true,
    },
    select,
  })
}
