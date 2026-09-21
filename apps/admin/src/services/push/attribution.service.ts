/**
 * R24 and KTD8 — a watch start that follows an open belongs to that campaign,
 * whichever of the two lands second.
 *
 * The forward join runs in the playback-context issuance resolver and reads
 * the opens this viewer already reported. The reverse join runs when an open is
 * stored and reads the contexts this session already issued. Both write one
 * denormalized row that is unique on the episode id, so the loser of the race
 * writes nothing.
 *
 * Attribution is a bonus on top of two paths that must not fail for it, so
 * every read runs under its own budget and every failure is answered, never
 * thrown. A mismatched open attributes nothing (KTD14).
 *
 * SECURITY: no log line here carries a digest, an episode id, or a media id.
 */
import type { PrismaClient } from "@prisma/client"

import type { PushStoredOpen } from "./open-report.service"

/** R24 — how long after an open a watch start still belongs to the campaign. */
export const PUSH_ATTRIBUTION_WINDOW_HOURS = 24
/**
 * KTD8 — a tap and the context it leads to can land in either order, so the
 * reverse join reaches back this far for a context issued just before the open.
 */
export const PUSH_ATTRIBUTION_REVERSE_GRACE_MS = 60 * 1_000
/** The reverse read never spans more than this, whatever the grace becomes. */
export const PUSH_ATTRIBUTION_REVERSE_MAX_LOOKBACK_MS = 10 * 60 * 1_000
/**
 * The budget both call sites hold. It is well inside the app's own request
 * ceiling, so a slow read costs a lost attribution and never a failed write.
 */
export const PUSH_ATTRIBUTION_BUDGET_MS = 1_500

const WINDOW_MS = PUSH_ATTRIBUTION_WINDOW_HOURS * 60 * 60 * 1_000
const REVERSE_LOOKBACK_MS = Math.min(
  PUSH_ATTRIBUTION_REVERSE_GRACE_MS,
  PUSH_ATTRIBUTION_REVERSE_MAX_LOOKBACK_MS,
)

export type PushAttributionDirection = "issuance" | "open_report"

export type PushAttributionOutcome =
  | "attributed"
  | "duplicate"
  | "no_open"
  | "no_episode"
  | "no_identity"
  | "mismatch"
  | "timeout"
  | "failed"

export type PushAttributionResult = Readonly<{
  outcome: PushAttributionOutcome
  campaignId: string | null
}>

/** What the issuance resolver knows about the context it just created. */
export type PushIssuedEpisode = Readonly<{
  episodeId: string
  mediaId: string
  viewerDigest: string | null
  sessionDigest: string | null
  /** The instant the context was issued. Defaults to now. */
  issuedAt?: Date
}>

const OPEN_SELECT = {
  id: true,
  campaignId: true,
  registrationId: true,
  viewerDigest: true,
  languageSlug: true,
  country: true,
} as const

type OpenRow = {
  id: string
  campaignId: string
  registrationId: string | null
  viewerDigest: string | null
  languageSlug: string | null
  country: string | null
}

const EPISODE_SELECT = { id: true, mediaId: true, createdAt: true } as const

type EpisodeRow = { id: string; mediaId: string; createdAt: Date }

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002"
  )
}

type AttributionRow = {
  episodeId: string
  openId: string
  campaignId: string
  registrationId: string | null
  viewerDigest: string | null
  languageSlug: string | null
  country: string | null
  mediaId: string
  attributedAt: Date
}

async function insertAttribution(
  prisma: PrismaClient,
  row: AttributionRow,
): Promise<PushAttributionResult> {
  try {
    await prisma.pushAttribution.create({ data: row })
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    // The other direction attributed this episode first. One episode is one
    // watch start, so the row that exists is the answer.
    return { outcome: "duplicate", campaignId: row.campaignId }
  }
  return { outcome: "attributed", campaignId: row.campaignId }
}

/**
 * The forward join. It reads the opens this viewer reported inside the window
 * before the issuance, newest first, and attributes the context to one of them.
 */
export async function attributeOpenToIssuedEpisode(
  prisma: PrismaClient,
  episode: PushIssuedEpisode,
): Promise<PushAttributionResult> {
  const issuedAt = episode.issuedAt ?? new Date()
  const receivedAt = {
    gte: new Date(issuedAt.getTime() - WINDOW_MS),
    lte: issuedAt,
  }
  const digests = [
    episode.viewerDigest != null
      ? { viewerDigest: episode.viewerDigest }
      : null,
    episode.sessionDigest != null
      ? { sessionDigest: episode.sessionDigest }
      : null,
  ].filter((rung) => rung !== null)
  if (digests.length === 0) return { outcome: "no_identity", campaignId: null }

  for (const rung of digests) {
    const open = (await prisma.pushOpen.findFirst({
      // A mismatched open is somebody else's tap on this phone (KTD14).
      where: { ...rung, viewerMismatch: false, receivedAt },
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      select: OPEN_SELECT,
    })) as OpenRow | null
    if (open === null) continue
    return await insertAttribution(prisma, {
      episodeId: episode.episodeId,
      openId: open.id,
      campaignId: open.campaignId,
      registrationId: open.registrationId,
      viewerDigest: open.viewerDigest,
      languageSlug: open.languageSlug,
      country: open.country,
      mediaId: episode.mediaId,
      attributedAt: issuedAt,
    })
  }
  return { outcome: "no_open", campaignId: null }
}

/**
 * The reverse join. It reads the contexts this session issued after the
 * delivery went out and inside the grace before the open, and attributes the
 * newest of them.
 *
 * It matches on the session digest alone because a playback episode carries no
 * viewer digest; the forward join is what covers a rotated session.
 */
export async function attributeEpisodeToStoredOpen(
  prisma: PrismaClient,
  open: PushStoredOpen,
): Promise<PushAttributionResult> {
  if (open.viewerMismatch) {
    return { outcome: "mismatch", campaignId: open.campaignId }
  }
  if (open.sessionDigest == null) {
    return { outcome: "no_identity", campaignId: open.campaignId }
  }

  const graceStart = new Date(open.receivedAt.getTime() - REVERSE_LOOKBACK_MS)
  const sendingAt = open.deliverySendingAt
  const gte =
    sendingAt != null && sendingAt.getTime() > graceStart.getTime()
      ? sendingAt
      : graceStart

  const episode = (await prisma.recommendationPlaybackEpisode.findFirst({
    where: {
      sessionDigest: open.sessionDigest,
      createdAt: { gte, lte: open.receivedAt },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: EPISODE_SELECT,
  })) as EpisodeRow | null
  if (episode === null) {
    return { outcome: "no_episode", campaignId: open.campaignId }
  }

  return await insertAttribution(prisma, {
    episodeId: episode.id,
    openId: open.id,
    campaignId: open.campaignId,
    registrationId: open.registrationId,
    viewerDigest: open.viewerDigest,
    languageSlug: open.languageSlug,
    country: open.country,
    mediaId: episode.mediaId,
    attributedAt: episode.createdAt,
  })
}

function report(
  direction: PushAttributionDirection,
  result: PushAttributionResult,
): PushAttributionResult {
  console.info(
    `[push] event=attribution direction=${direction} outcome=${result.outcome} campaign=${result.campaignId ?? "none"}`,
  )
  return result
}

/**
 * Runs one join under the shared budget. The work keeps going after the
 * deadline wins, because a row that lands late is still the right row; the
 * caller simply stops waiting for it.
 */
async function runBounded(
  direction: PushAttributionDirection,
  work: Promise<PushAttributionResult>,
): Promise<PushAttributionResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  // The loser of the race still settles, so its failure is handled here or it
  // escapes as an unhandled rejection.
  const guarded = work.then(
    (result) => result,
    (error): PushAttributionResult => {
      console.error(
        `[push] event=attribution_failed direction=${direction} error=${error instanceof Error ? error.name : "unknown"}`,
      )
      return { outcome: "failed", campaignId: null }
    },
  )
  const deadline = new Promise<PushAttributionResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ outcome: "timeout", campaignId: null }),
      PUSH_ATTRIBUTION_BUDGET_MS,
    )
  })
  try {
    return report(direction, await Promise.race([guarded, deadline]))
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** The issuance resolver's call. It never throws and never changes a receipt. */
export function attributePushOpenAfterIssuance(
  prisma: PrismaClient,
  episode: PushIssuedEpisode,
): Promise<PushAttributionResult> {
  return runBounded("issuance", attributeOpenToIssuedEpisode(prisma, episode))
}

/** The open report's hook. It never throws and never changes a receipt. */
export function attributeEpisodeAfterPushOpen(
  prisma: PrismaClient,
  open: PushStoredOpen,
): Promise<PushAttributionResult> {
  return runBounded("open_report", attributeEpisodeToStoredOpen(prisma, open))
}
