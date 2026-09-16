import { Prisma, type RecommendationPlaybackEpisode } from "@prisma/client"
import { RECOMMENDATION_REPLAY_QUARANTINE_THRESHOLD } from "./integrity-policy"
import {
  summarizeViewingMode,
  viewingModePreference,
  VIEWING_MODE_VERSION,
  VIEWING_MODE_RANKER_VERSION,
  type ViewingModeAffinity,
} from "./viewing-mode"
import { RecommendationBindingError } from "./errors"

/** Fence a prepared mode-ranked slate against reset before it is issued. */
export async function lockViewingModeAuthority(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: {
    affinity: ViewingModeAffinity
    profileTokenDigest: string
    now: Date
  },
) {
  const active = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM recommendation_profile
    WHERE id = ${input.affinity.authority.profileId} AND privacy_generation = ${input.affinity.authority.privacyGeneration}
      AND token_digest = ${input.profileTokenDigest} AND state = 'active' AND expires_at > ${input.now}
    FOR SHARE
  `)
  if (active.length !== 1)
    throw new RecommendationBindingError(
      "Viewing-mode profile generation is stale",
    )
}

/** Called only under the episode's existing serializable write transaction. */
export async function projectViewingModeEvidence(
  tx: Prisma.TransactionClient,
  episode: RecommendationPlaybackEpisode,
  now: Date,
) {
  if (!episode.claimedAt || episode.conflictCount > 0) return
  // An old episode cannot acquire a new identity after reset. The profile row
  // share lock orders this publication with reset/withdrawal's row update.
  const profiles = await tx.$queryRaw<
    Array<{ id: string; privacyGeneration: number }>
  >(Prisma.sql`
    SELECT profile.id, profile.privacy_generation AS "privacyGeneration"
    FROM recommendation_profile profile
    JOIN recommendation_profile_session_link link ON link.profile_id = profile.id
      AND link.privacy_generation = profile.privacy_generation
    WHERE link.session_digest = ${episode.sessionDigest}
      AND link.linked_at <= ${episode.createdAt} AND link.expires_at > ${now}
      AND profile.state = 'active' AND profile.token_digest IS NOT NULL AND profile.expires_at > ${now}
    ORDER BY link.linked_at DESC, link.id DESC LIMIT 1 FOR SHARE OF profile
  `)
  const profile = profiles[0]
  if (!profile) return
  const facts = await tx.recommendationPlaybackFact.findMany({
    where: { episodeId: episode.id },
    orderBy: { sequence: "asc" },
    take: 128,
    select: {
      kind: true,
      payload: true,
      occurredAt: true,
      late: true,
      sequence: true,
    },
  })
  if (facts.some((fact) => fact.late)) return
  const summary = summarizeViewingMode(facts, episode.claimedAt)
  const last = facts
    .filter((fact) => fact.kind === "playback_viewing_mode")
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .at(-1)
  if (!last) return
  const update = {
    ...summary,
    factWatermark: facts.at(-1)!.sequence,
    observedAt: last.occurredAt,
  }
  await tx.recommendationViewingModeEvidence.upsert({
    where: { episodeId: episode.id },
    create: {
      ...update,
      episodeId: episode.id,
      profileId: profile.id,
      privacyGeneration: profile.privacyGeneration,
      sessionDigest: episode.sessionDigest,
      mediaId: episode.mediaId,
      policyVersion: VIEWING_MODE_VERSION,
      expiresAt: episode.expiresAt,
    },
    update,
  })
}

// This independent mode facet uses raw observable progress. It does not relabel
// the legacy manual-play outcome or bypass its topic-interest classifier.
function eligibleModeSql(now: Date): Prisma.Sql {
  return Prisma.sql`
    evidence.policy_version = ${VIEWING_MODE_VERSION} AND evidence.expires_at > ${now}
    AND profile.state = 'active' AND profile.token_digest IS NOT NULL
    AND profile.privacy_generation = evidence.privacy_generation AND profile.expires_at > ${now}
    AND episode.expires_at > ${now} AND episode.conflict_count = 0
    AND episode.replay_count < ${RECOMMENDATION_REPLAY_QUARANTINE_THRESHOLD}
    AND NOT EXISTS (SELECT 1 FROM recommendation_playback_fact invalid WHERE invalid.episode_id = episode.id
      AND (invalid.late = true OR invalid.kind = 'playback_error'))
    AND NOT EXISTS (SELECT 1 FROM recommendation_promotion_slate_fence fence WHERE fence.request_id = episode.request_id)
  `
}

export async function loadViewingModeAffinity(
  tx: Prisma.TransactionClient,
  input: {
    profileTokenDigest: string
    mediaIds: readonly string[]
    now: Date
  },
): Promise<ViewingModeAffinity | null> {
  const profile = await tx.recommendationProfile.findUnique({
    where: { tokenDigest: input.profileTokenDigest },
  })
  if (!profile || profile.state !== "ACTIVE" || profile.expiresAt <= input.now)
    return null
  const rows = await tx.$queryRaw<
    Array<{
      mediaId: string
      soundOffMilliseconds: number
      soundOnMilliseconds: number
      soundOffProgressSeconds: number
      soundOnProgressSeconds: number
      soundOffQualified: boolean
      soundOnQualified: boolean
      previewMilliseconds: number
      durationSeconds: number | null
    }>
  >(Prisma.sql`
    SELECT evidence.media_id AS "mediaId", evidence.sound_off_milliseconds AS "soundOffMilliseconds",
      evidence.sound_on_milliseconds AS "soundOnMilliseconds", evidence.sound_off_progress_seconds AS "soundOffProgressSeconds",
      evidence.sound_on_progress_seconds AS "soundOnProgressSeconds", evidence.sound_off_qualified AS "soundOffQualified",
      evidence.sound_on_qualified AS "soundOnQualified", evidence.preview_milliseconds AS "previewMilliseconds",
      evidence.duration_seconds AS "durationSeconds"
    FROM (SELECT * FROM recommendation_viewing_mode_evidence
      WHERE profile_id = ${profile.id} AND privacy_generation = ${profile.privacyGeneration}
      ORDER BY observed_at DESC, episode_id DESC LIMIT 128) evidence
    JOIN recommendation_profile profile ON profile.id = evidence.profile_id
    JOIN recommendation_playback_episode episode ON episode.id = evidence.episode_id
    WHERE ${eligibleModeSql(input.now)}
    ORDER BY evidence.observed_at DESC, evidence.episode_id DESC
  `)
  const preference = viewingModePreference(rows)
  if (!preference.qualifiedVideos || preference.soundOffPreference <= 0.5)
    return null
  const mediaIds = [...new Set(input.mediaIds)].slice(0, 64)
  if (!mediaIds.length) return null
  // At most 64 indexed seeks and 512 recent episodes per candidate; no catalog
  // scan on the serving path. Each current profile contributes at most one vote.
  const performance = await tx.$queryRaw<
    Array<{ mediaId: string; viewers: number; qualifiedViewers: number }>
  >(Prisma.sql`
    SELECT candidates.media_id AS "mediaId", COUNT(DISTINCT sampled.profile_id)::int AS viewers,
      COUNT(DISTINCT sampled.profile_id) FILTER (WHERE sampled.sound_off_qualified)::int AS "qualifiedViewers"
    FROM unnest(ARRAY[${Prisma.join(mediaIds)}]::text[]) AS candidates(media_id)
    CROSS JOIN LATERAL (
      SELECT DISTINCT ON (bounded.profile_id) bounded.profile_id, bounded.sound_off_qualified
      FROM (
        SELECT evidence.profile_id, evidence.sound_off_qualified, evidence.observed_at, evidence.episode_id
        FROM (SELECT * FROM recommendation_viewing_mode_evidence
          WHERE media_id = candidates.media_id ORDER BY observed_at DESC, episode_id DESC LIMIT 512) evidence
        JOIN recommendation_profile profile ON profile.id = evidence.profile_id
        JOIN recommendation_playback_episode episode ON episode.id = evidence.episode_id
        WHERE evidence.sound_off_milliseconds >= 3000
          AND evidence.profile_id <> ${profile.id} AND ${eligibleModeSql(input.now)}
      ) bounded ORDER BY bounded.profile_id, bounded.observed_at DESC, bounded.episode_id DESC
    ) sampled GROUP BY candidates.media_id
    HAVING COUNT(DISTINCT sampled.profile_id) >= 20
  `)
  return {
    version: VIEWING_MODE_RANKER_VERSION,
    authority: {
      profileId: profile.id,
      privacyGeneration: profile.privacyGeneration,
    },
    ...preference,
    candidates: performance.map((row) => ({
      ...row,
      affinity: Math.max(
        0,
        2 * ((row.qualifiedViewers + 2) / (row.viewers + 4) - 0.5),
      ),
    })),
  }
}
