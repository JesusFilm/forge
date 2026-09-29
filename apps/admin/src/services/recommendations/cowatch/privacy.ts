import { Prisma } from "@prisma/client"

/** Run before profile session links are removed in the same erasure transaction. */
export async function suppressCowatchForProfiles(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  profileIds: readonly string[],
): Promise<void> {
  if (profileIds.length === 0) return
  const ids = Prisma.join(profileIds)
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO recommendation_cowatch_suppression (episode_id, expires_at)
    SELECT DISTINCT episode.id, episode.expires_at
    FROM recommendation_playback_episode episode
    JOIN recommendation_profile_session_link link
      ON link.session_digest = episode.session_digest
    WHERE link.profile_id IN (${ids})
    UNION
    SELECT DISTINCT episode.id, episode.expires_at
    FROM recommendation_cowatch_source_contribution source
    JOIN recommendation_outcome_revision outcome ON outcome.id = source.outcome_id
    JOIN recommendation_playback_episode episode ON episode.id = outcome.episode_id
    WHERE source.viewer_profile_id IN (${ids})
    ON CONFLICT (episode_id) DO NOTHING
  `)
  await tx.$executeRaw(Prisma.sql`
    DELETE FROM recommendation_cowatch_contribution contribution
    WHERE contribution.viewer_profile_id IN (${ids})
      OR contribution.session_digest IN (
        SELECT link.session_digest
        FROM recommendation_profile_session_link link
        WHERE link.profile_id IN (${ids})
      )
  `)
  await tx.$executeRaw(Prisma.sql`
    DELETE FROM recommendation_cowatch_source_contribution source
    WHERE source.viewer_profile_id IN (${ids})
      OR source.session_digest IN (
        SELECT link.session_digest
        FROM recommendation_profile_session_link link
        WHERE link.profile_id IN (${ids})
      )
  `)
}
