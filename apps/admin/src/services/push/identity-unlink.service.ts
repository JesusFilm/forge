import type { Prisma, PrismaClient } from "@prisma/client"

/** The unlink runs inside the caller's transaction, so it accepts either. */
export type PushUnlinkClient = PrismaClient | Prisma.TransactionClient

export type PushIdentityUnlinkResult = Readonly<{
  registrationsUnlinked: number
  opensDeleted: number
  attributionsDeleted: number
}>

const EMPTY: PushIdentityUnlinkResult = {
  registrationsUnlinked: 0,
  opensDeleted: 0,
  attributionsDeleted: 0,
}

/**
 * Ends a viewer identity's link to push. It nulls the digest on every
 * registration that carries it and deletes that digest's opens and
 * attributions.
 *
 * It never deletes a registration: the phone keeps its push address, so an
 * erased viewer still receives the announcements they granted permission for.
 * A consent withdrawal must not call this — push attribution is product
 * analytics, not personalization.
 */
export async function unlinkPushViewerIdentities(
  client: PushUnlinkClient,
  viewerDigests: readonly string[],
): Promise<PushIdentityUnlinkResult> {
  const digests = [...new Set(viewerDigests.filter((digest) => digest))]
  if (digests.length === 0) return EMPTY
  const where = { viewerDigest: { in: digests } }
  const attributions = await client.pushAttribution.deleteMany({ where })
  const opens = await client.pushOpen.deleteMany({ where })
  const registrations = await client.pushRegistration.updateMany({
    where,
    data: { viewerDigest: null },
  })
  return {
    registrationsUnlinked: registrations.count,
    opensDeleted: opens.count,
    attributionsDeleted: attributions.count,
  }
}
