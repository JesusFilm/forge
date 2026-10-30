import { Prisma, type PrismaClient } from "@prisma/client"

import type { VerifiedSeoWorkloadAssertion } from "./seo-service-assertion"

type SeoAssertionLedgerClient = Pick<
  PrismaClient | Prisma.TransactionClient,
  "seoWorkloadAssertion"
>

export class SeoAssertionReplayError extends Error {
  constructor() {
    super("SEO assertion has already been consumed")
    this.name = "SeoAssertionReplayError"
  }
}

export async function consumeSeoWorkloadAssertion(
  client: SeoAssertionLedgerClient,
  assertion: VerifiedSeoWorkloadAssertion,
) {
  try {
    await client.seoWorkloadAssertion.create({
      data: {
        jtiHash: assertion.jtiHash,
        keyId: assertion.keyId,
        environment: assertion.environment,
        audience: assertion.audience,
        capability: assertion.capability,
        requestDigest: assertion.requestDigest,
        expiresAt: assertion.expiresAt,
      },
    })
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new SeoAssertionReplayError()
    }
    throw error
  }
}
