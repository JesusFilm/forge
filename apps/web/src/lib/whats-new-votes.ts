"use client"

import { adminGraphql, type AdminResultOf } from "@forge/admin-graphql"

import { env } from "@/env"

/**
 * Sticker voting for /watch/whats-new, browser-direct to Admin GraphQL.
 *
 * Browser-direct — the documented exception this follows is the floating Watch
 * search (`watch-search-client.ts`): the mutation is `public: true`, carries no
 * Admin bearer, and the page is statically cached so a server hop would buy
 * nothing. Admin's edge rate limiter buckets anonymous mutations per IP and its
 * service caps what one ballot can hold; nothing here is trusted.
 *
 * A ballot id is NOT an identity. It is a random per-browser token that exists
 * so a reader can take a sticker back and so a retried send cannot double
 * count. Clearing site data mints a new one, which is the accepted trade for a
 * page with no login.
 */

const BALLOT_STORAGE_KEY = "watch:whats-new:ballot"
const VOTE_TIMEOUT_MS = 8_000

export type WhatsNewVoteTally = { featureId: string; votes: number }

/** What the store can tell a card: null until the first read lands. */
export type WhatsNewVoteCounts = Readonly<Record<string, number>> | null

/**
 * The document text is what goes on the wire; the `adminGraphql(...)` node
 * beside it exists so the text is checked against Admin's schema at compile
 * time. Posting the node instead would send "[object Object]" — the same split
 * the floating Watch search client uses, for the same reason.
 *
 * Each node is consumed only through `AdminResultOf<typeof …>`, which lint
 * reads as "unused value". The value is the point: it is the call that makes
 * gql.tada check the document above it against admin's SDL, so a renamed field
 * or a wrong argument type fails the build instead of failing per request.
 */
const talliesQuery = `
  query WhatsNewFeatureVoteTallies {
    whatsNewFeatureVoteTallies {
      featureId
      votes
    }
  }
`
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- schema check, see above
const talliesOperation = adminGraphql(talliesQuery)

const castMutation = `
  mutation CastWhatsNewFeatureVote(
    $ballotId: String!
    $placementId: String!
    $featureId: String!
    $sticker: WhatsNewSticker!
  ) {
    castWhatsNewFeatureVote(
      ballotId: $ballotId
      placementId: $placementId
      featureId: $featureId
      sticker: $sticker
    ) {
      accepted
      refusal
      tallies {
        featureId
        votes
      }
    }
  }
`
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- schema check, see above
const castOperation = adminGraphql(castMutation)

const retractMutation = `
  mutation RetractWhatsNewFeatureVote(
    $ballotId: String!
    $placementId: String
  ) {
    retractWhatsNewFeatureVote(ballotId: $ballotId, placementId: $placementId) {
      accepted
      refusal
      tallies {
        featureId
        votes
      }
    }
  }
`
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- schema check, see above
const retractOperation = adminGraphql(retractMutation)

/**
 * The sticker kinds Admin's enum accepts. Typed off the generated variables so
 * a kind added to web's content file without a matching Admin enum value fails
 * to COMPILE rather than being rejected at runtime, one vote at a time.
 */
export type WhatsNewVoteSticker = "love" | "yes" | "need"

type GraphqlResponse<TData> = {
  data?: TData | null
  errors?: Array<{ message?: string | null }>
}

/**
 * A vote that could not be sent is kept, not lost: the caller queues it and
 * flushes later. The page claims votes are recorded, so a dropped request has
 * to be a retry, not a quiet lie.
 */
export class WhatsNewVoteTransportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WhatsNewVoteTransportError"
  }
}

/** Random, opaque, and long enough to satisfy Admin's id shape. */
function mintId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  return `${prefix}_${random}`.slice(0, 80)
}

export function mintPlacementId(): string {
  return mintId("pl")
}

/**
 * The browser's ballot, created on first use. Storage can be unavailable
 * (Safari private mode, a blocked third-party context), in which case voting
 * still works for the session — the ballot just does not survive a reload.
 */
let memoryBallotId: string | null = null

export function readBallotId(): string {
  try {
    const stored = window.localStorage.getItem(BALLOT_STORAGE_KEY)
    if (stored != null && /^[A-Za-z0-9_-]{8,80}$/.test(stored)) return stored
    const minted = mintId("ba")
    window.localStorage.setItem(BALLOT_STORAGE_KEY, minted)
    return minted
  } catch {
    memoryBallotId ??= mintId("ba")
    return memoryBallotId
  }
}

async function post<TData>(
  query: string,
  variables: Record<string, unknown>,
): Promise<TData> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), VOTE_TIMEOUT_MS)
  try {
    const response = await fetch(env.NEXT_PUBLIC_ADMIN_GRAPHQL_URL, {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new WhatsNewVoteTransportError(`HTTP ${response.status}`)
    }
    const payload = (await response.json()) as GraphqlResponse<TData>
    if (payload.errors?.length) {
      throw new WhatsNewVoteTransportError(
        payload.errors[0]?.message ?? "GraphQL error",
      )
    }
    if (payload.data == null) {
      throw new WhatsNewVoteTransportError("Empty response")
    }
    return payload.data
  } catch (error) {
    if (error instanceof WhatsNewVoteTransportError) throw error
    throw new WhatsNewVoteTransportError(
      error instanceof Error ? error.message : "Vote request failed",
    )
  } finally {
    clearTimeout(timeout)
  }
}

function toCounts(
  rows: readonly (WhatsNewVoteTally | null)[] | null | undefined,
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const row of rows ?? []) {
    if (row == null) continue
    if (typeof row.featureId !== "string") continue
    if (!Number.isFinite(row.votes)) continue
    counts[row.featureId] = row.votes
  }
  return counts
}

export async function fetchVoteCounts(): Promise<
  Readonly<Record<string, number>>
> {
  const data = await post<AdminResultOf<typeof talliesOperation>>(
    talliesQuery,
    {},
  )
  return toCounts(data.whatsNewFeatureVoteTallies)
}

/**
 * The outcome of a write, as the caller needs it.
 *
 * `accepted: false` is a settled answer — the budget is spent, or the input was
 * refused — and must NOT be retried. Only a thrown transport error means "try
 * again": the sticker is already on the card and the page says the vote was
 * recorded, so a dropped request has to be a retry rather than a quiet lie.
 */
export type WhatsNewVoteOutcome = {
  accepted: boolean
  counts: Readonly<Record<string, number>>
}

export async function castVote(input: {
  ballotId: string
  placementId: string
  featureId: string
  sticker: WhatsNewVoteSticker
}): Promise<WhatsNewVoteOutcome> {
  const data = await post<AdminResultOf<typeof castOperation>>(
    castMutation,
    input,
  )
  const result = data.castWhatsNewFeatureVote
  return {
    accepted: result.accepted,
    counts: toCounts(result.tallies),
  }
}

export async function retractVote(input: {
  ballotId: string
  /** Omit to take the whole ballot back — "take my stickers back". */
  placementId?: string | null
}): Promise<WhatsNewVoteOutcome> {
  const data = await post<AdminResultOf<typeof retractOperation>>(
    retractMutation,
    {
      ballotId: input.ballotId,
      placementId: input.placementId ?? null,
    },
  )
  const result = data.retractWhatsNewFeatureVote
  return {
    accepted: result.accepted,
    counts: toCounts(result.tallies),
  }
}
