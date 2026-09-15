import type { PrismaClient } from "@prisma/client"

type ProfileProjectionPrivacyClient = Pick<
  PrismaClient,
  | "recommendationProfileSessionLink"
  | "recommendationProfileProjectionRun"
  | "recommendationProfileProjectionPointer"
  | "recommendationProfileProjectionGeneration"
>

/**
 * Removes every private U19 influence reachable from one consent generation.
 * Linked anonymous-session projections are included before the link rows are
 * removed, preventing a reset or withdrawal from leaving a usable projection.
 */
export async function eraseProfileProjectionInfluence(
  client: ProfileProjectionPrivacyClient,
  input: { profileId: string; privacyGeneration: number },
) {
  const links = await client.recommendationProfileSessionLink.findMany({
    where: {
      profileId: input.profileId,
      privacyGeneration: input.privacyGeneration,
    },
    select: { sessionDigest: true },
  })
  const sessionDigests = [...new Set(links.map((link) => link.sessionDigest))]
  const scope = {
    OR: [
      {
        profileId: input.profileId,
        privacyGeneration: input.privacyGeneration,
      },
      ...(sessionDigests.length > 0
        ? [{ sessionDigest: { in: sessionDigests } }]
        : []),
    ],
  }
  const runs = await client.recommendationProfileProjectionRun.deleteMany({
    where: scope,
  })
  const pointers =
    await client.recommendationProfileProjectionPointer.deleteMany({
      where: scope,
    })
  const generations =
    await client.recommendationProfileProjectionGeneration.deleteMany({
      where: scope,
    })
  return {
    sessionDigests: sessionDigests.length,
    runs: runs.count,
    pointers: pointers.count,
    generations: generations.count,
  }
}
