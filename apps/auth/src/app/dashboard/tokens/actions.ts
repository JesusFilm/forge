"use server"

import { revalidatePath } from "next/cache"

import { requireAuthOperator } from "@/auth/operator"
import { prisma } from "@/db/client"
import { buildAuditEvent } from "@/services/audit.service"

export async function revokeTokenRecord(formData: FormData) {
  const operator = await requireAuthOperator()
  const tokenId = String(formData.get("tokenId") ?? "")
  if (!tokenId) return

  const token = await prisma.tokenRecord.findUnique({
    where: { id: tokenId },
    select: {
      id: true,
      tokenHash: true,
      status: true,
      appId: true,
      audience: true,
    },
  })

  if (!token || token.status === "REVOKED") return

  await prisma.$transaction([
    prisma.tokenRecord.update({
      where: { id: token.id },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        revocationReason: "operator_revoked",
      },
    }),
    prisma.authAuditEvent.create({
      data: buildAuditEvent({
        eventType: "operator.token.revoked",
        severity: "warning",
        actorUserId: operator.id,
        appId: token.appId,
        subject: token.tokenHash,
        metadata: {
          audience: token.audience,
          tokenHash: token.tokenHash,
        },
      }),
    }),
  ])

  revalidatePath("/dashboard/tokens")
}
