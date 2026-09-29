import { createHash, randomUUID } from "node:crypto"
import { Prisma, RecommendationProfileProjectionScope } from "@prisma/client"
import { loadDatabaseProfileProjectionEvidence } from "./profile-projection.service"
import { resolveActiveRecommendationProfileLink } from "./active-profile-link"

type BootstrapScope = Readonly<{
  profileId: string
  privacyGeneration: number
  sessionDigest: string
  now: Date
}>

/** Only an untouched, active durable scope can avoid its first projection run. */
export async function canSkipInitialEmptyProfileBootstrap(
  tx: Prisma.TransactionClient,
  input: BootstrapScope,
): Promise<boolean> {
  const [profile] = await tx.$queryRaw<Array<{ createdAt: Date }>>(Prisma.sql`
    SELECT created_at AS "createdAt"
    FROM recommendation_profile
    WHERE id = ${input.profileId}
      AND privacy_generation = ${input.privacyGeneration}
      AND state = 'active'
      AND token_digest IS NOT NULL
      AND expires_at > ${input.now}
    FOR SHARE
  `)
  if (!profile) return false

  const [state] = await tx.$queryRaw<
    Array<{ hasLink: boolean; hasGeneration: boolean; hasRun: boolean }>
  >(Prisma.sql`
    SELECT
      EXISTS (
        SELECT 1 FROM recommendation_profile_session_link link
        WHERE link.profile_id = ${input.profileId}
          AND link.privacy_generation = ${input.privacyGeneration}
          AND link.session_digest = ${input.sessionDigest}
          AND link.expires_at > ${input.now}
      ) AS "hasLink",
      EXISTS (
        SELECT 1 FROM recommendation_profile_projection_generation generation
        WHERE generation.profile_id = ${input.profileId}
          AND generation.privacy_generation = ${input.privacyGeneration}
      ) AS "hasGeneration",
      EXISTS (
        SELECT 1 FROM recommendation_profile_projection_run run
        WHERE run.profile_id = ${input.profileId}
          AND run.privacy_generation = ${input.privacyGeneration}
      ) AS "hasRun"
  `)
  if (!state?.hasLink || state.hasGeneration || state.hasRun) return false

  // Raw sources can be waiting for an impression, eligibility verdict, outcome
  // finalization or content embedding. None may be treated as "no evidence".
  // Every active link is checked, including the initiating session.
  const [raw] = await tx.$queryRaw<Array<{ hasRawSource: boolean }>>(Prisma.sql`
    SELECT
      (
        EXISTS (
          SELECT 1
          FROM recommendation_profile_session_link link
          JOIN recommendation_request request
            ON request.session_digest = link.session_digest
          JOIN recommendation_selection selection
            ON selection.request_id = request.id
          WHERE link.profile_id = ${input.profileId}
            AND link.privacy_generation = ${input.privacyGeneration}
            AND link.expires_at > ${input.now}
            AND request.expires_at > ${input.now}
            AND selection.expires_at > ${input.now}
            AND selection.occurred_at >= GREATEST(${profile.createdAt}, link.linked_at)
        ) OR EXISTS (
          SELECT 1
          FROM recommendation_profile_session_link link
          JOIN recommendation_playback_episode episode
            ON episode.session_digest = link.session_digest
          WHERE link.profile_id = ${input.profileId}
            AND link.privacy_generation = ${input.privacyGeneration}
            AND link.expires_at > ${input.now}
            AND episode.expires_at > ${input.now}
            AND COALESCE(episode.claimed_at, episode.created_at)
              >= GREATEST(${profile.createdAt}, link.linked_at)
        )
      ) AS "hasRawSource"
  `)
  if (!raw || raw.hasRawSource) return false

  // The current projector has no persisted explicit/negative source yet. Check
  // all current loader channels; any new persisted raw channel must also be
  // added to the raw absence guard and its native contract tests.
  const evidence = await loadDatabaseProfileProjectionEvidence(tx, {
    profileId: input.profileId,
    privacyGeneration: input.privacyGeneration,
    sessionDigest: input.sessionDigest,
    now: input.now,
  })
  return (
    evidence.durable.length === 0 &&
    evidence.session.length === 0 &&
    evidence.explicitPreferences.length === 0 &&
    evidence.negativeEvidence.length === 0
  )
}

/**
 * An eligible first source and its recoverable workflow reservation commit
 * together. The existing stale-run reconciler dispatches a null-workflow run
 * if the fail-open feedback callback cannot start it after commit.
 */
type InitialReservation = Readonly<{
  profileId: string
  privacyGeneration: number
  sessionDigest: string
  now: Date
}>

export async function prepareInitialProfileProjectionReservation(
  tx: Prisma.TransactionClient,
  input: { sessionDigest: string; now: Date },
): Promise<InitialReservation | null> {
  const active = await resolveActiveRecommendationProfileLink(tx, input)
  if (!active) return null
  const scopeDigest = createHash("sha256")
    .update(`durable:${active.profileId}:${active.privacyGeneration}`)
    .digest("hex")
  // The common already-projected classifier path needs no advisory or profile
  // row lock. A missing pointer is rechecked under the scope lock below.
  const priorPointer =
    await tx.recommendationProfileProjectionPointer.findUnique({
      where: { scopeDigest },
      select: { scopeDigest: true },
    })
  if (priorPointer) return null
  await tx.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`profile-projection-dispatch:${scopeDigest}`}, 459)
    )
  `)
  const [profile] = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT profile.id
    FROM recommendation_profile profile
    JOIN recommendation_profile_session_link link
      ON link.profile_id = profile.id
     AND link.privacy_generation = profile.privacy_generation
    WHERE profile.id = ${active.profileId}
      AND profile.privacy_generation = ${active.privacyGeneration}
      AND profile.state = 'active'
      AND profile.token_digest IS NOT NULL
      AND profile.created_at <= ${input.now}
      AND profile.expires_at > ${input.now}
      AND link.session_digest = ${input.sessionDigest}
      AND link.linked_at <= ${input.now}
      AND link.expires_at > ${input.now}
    FOR SHARE OF profile, link
  `)
  if (!profile) return null
  const [existing] = await tx.$queryRaw<
    Array<{ hasPointer: boolean; hasGeneration: boolean; hasRun: boolean }>
  >(Prisma.sql`
    SELECT
      EXISTS (
        SELECT 1 FROM recommendation_profile_projection_pointer
        WHERE scope_digest = ${scopeDigest}
      ) AS "hasPointer",
      EXISTS (
        SELECT 1 FROM recommendation_profile_projection_generation
        WHERE profile_id = ${active.profileId}
          AND privacy_generation = ${active.privacyGeneration}
      ) AS "hasGeneration",
      EXISTS (
        SELECT 1 FROM recommendation_profile_projection_run
        WHERE profile_id = ${active.profileId}
          AND privacy_generation = ${active.privacyGeneration}
      ) AS "hasRun"
  `)
  if (
    !existing ||
    existing.hasPointer ||
    existing.hasGeneration ||
    existing.hasRun
  )
    return null
  return {
    profileId: active.profileId,
    privacyGeneration: active.privacyGeneration,
    sessionDigest: input.sessionDigest,
    now: input.now,
  }
}

export async function insertInitialProfileProjectionReservation(
  tx: Prisma.TransactionClient,
  reservation: InitialReservation,
): Promise<void> {
  await tx.recommendationProfileProjectionRun.create({
    data: {
      id: randomUUID(),
      scope: RecommendationProfileProjectionScope.DURABLE,
      profileId: reservation.profileId,
      privacyGeneration: reservation.privacyGeneration,
      sessionDigest: reservation.sessionDigest,
      reconciliationCause: "evidence_advanced",
      expectedPointerGeneration: 0,
      expiresAt: new Date(reservation.now.getTime() + 24 * 3_600_000),
    },
  })
}
