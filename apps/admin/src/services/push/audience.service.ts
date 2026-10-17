/**
 * R12 and R26 — who a campaign reaches, one bounded page at a time.
 *
 * Countries choose who; the declared-language filter narrows that set by the
 * device's own two language slugs, never by the copy the device would receive.
 * A device no transport can reach is returned beside the audience, not inside
 * it, so the report can count it as unreachable.
 */
import {
  PushRegistrationStatus,
  type Prisma,
  type PrismaClient,
  type PushAudienceScope,
  type PushPlatform,
} from "@prisma/client"

import { PushInputError } from "./errors"

/** KTD15 — pages are 5000 devices. */
export const PUSH_AUDIENCE_PAGE_LIMIT = 5_000
export const PUSH_AUDIENCE_MAX_PAGE_LIMIT = 20_000
/** Google's service does not deliver to Android devices here (R26). */
export const PUSH_DEFAULT_BLOCKED_COUNTRIES: readonly string[] = ["CN"]

export type PushAudienceCampaign = Readonly<{
  audienceScope: PushAudienceScope
  countries: readonly string[]
  languageFilter: readonly string[]
}>

export type PushAudienceRegistration = Readonly<{
  id: string
  expoPushToken: string
  platform: PushPlatform
  appLanguageSlug: string
  phoneLanguageSlug: string | null
  phoneLocale: string
  timeZone: string
  country: string | null
}>

export type PushAudiencePage = Readonly<{
  audience: PushAudienceRegistration[]
  unreachable: PushAudienceRegistration[]
  nextCursor: string | null
}>

export type PushAudienceQuery = Readonly<{
  campaign: PushAudienceCampaign
  /** The zone group. Omitted reads every zone, which is the send-now case. */
  timeZones?: readonly string[]
  cursor?: string | null
  limit?: number
  blockedCountries?: readonly string[]
}>

const AUDIENCE_COLUMNS = {
  id: true,
  expoPushToken: true,
  platform: true,
  appLanguageSlug: true,
  phoneLanguageSlug: true,
  phoneLocale: true,
  timeZone: true,
  country: true,
} as const

function pageLimit(limit: number | undefined): number {
  const value = limit ?? PUSH_AUDIENCE_PAGE_LIMIT
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > PUSH_AUDIENCE_MAX_PAGE_LIMIT
  ) {
    throw new PushInputError(`The audience page limit ${value} is invalid`)
  }
  return value
}

/**
 * KTD10 — the one audience predicate. The send pages, the dashboard's counts,
 * and the agent's per-language counts all read it.
 */
export function pushAudienceWhere(
  query: PushAudienceQuery,
): Prisma.PushRegistrationWhereInput {
  const { campaign, timeZones, cursor } = query
  const filter = [...campaign.languageFilter]
  return {
    status: PushRegistrationStatus.ACTIVE,
    ...(campaign.audienceScope === "COUNTRIES"
      ? { country: { in: [...campaign.countries] } }
      : {}),
    ...(timeZones ? { timeZone: { in: [...timeZones] } } : {}),
    ...(filter.length > 0
      ? {
          OR: [
            { appLanguageSlug: { in: filter } },
            { phoneLanguageSlug: { in: filter } },
          ],
        }
      : {}),
    ...(cursor ? { id: { gt: cursor } } : {}),
  }
}

function blockedSet(query: PushAudienceQuery): Set<string> {
  const blocked = query.blockedCountries ?? PUSH_DEFAULT_BLOCKED_COUNTRIES
  return new Set(blocked.map((country) => country.toUpperCase()))
}

function isUnreachable(
  registration: PushAudienceRegistration,
  blocked: ReadonlySet<string>,
): boolean {
  if (registration.platform !== "ANDROID") return false
  const country = registration.country?.toUpperCase()
  return country != null && blocked.has(country)
}

/** One page of the audience, ordered by id so the cursor cannot skip a device. */
export async function readPushAudiencePage(
  prisma: PrismaClient,
  query: PushAudienceQuery,
): Promise<PushAudiencePage> {
  const take = pageLimit(query.limit)
  const rows = (await prisma.pushRegistration.findMany({
    where: pushAudienceWhere(query),
    orderBy: { id: "asc" },
    take,
    select: AUDIENCE_COLUMNS,
  })) as PushAudienceRegistration[]

  const blocked = blockedSet(query)
  const audience: PushAudienceRegistration[] = []
  const unreachable: PushAudienceRegistration[] = []
  for (const row of rows) {
    if (isUnreachable(row, blocked)) unreachable.push(row)
    else audience.push(row)
  }
  // The cursor follows the last row read, reachable or not, or a blocked
  // device would be read again on every later page.
  return {
    audience,
    unreachable,
    nextCursor: rows.length === take ? (rows.at(-1)?.id ?? null) : null,
  }
}

/**
 * The audience devices that no transport can reach, or null when no country is
 * blocked. AND, never a spread: a spread replaces the campaign's own country
 * filter with the blocked list and counts devices the campaign never targets.
 */
export function pushUnreachableWhere(
  query: PushAudienceQuery,
): Prisma.PushRegistrationWhereInput | null {
  const blocked = [...blockedSet(query)]
  if (blocked.length === 0) return null
  return {
    AND: [
      pushAudienceWhere(query),
      { platform: "ANDROID", country: { in: blocked } },
    ],
  }
}

/** The counts the send-now confirmation shows (KTD10). */
export async function countPushAudience(
  prisma: PrismaClient,
  query: PushAudienceQuery,
): Promise<{ audience: number; unreachable: number }> {
  const matching = await prisma.pushRegistration.count({
    where: pushAudienceWhere(query),
  })
  const unreachableWhere = pushUnreachableWhere(query)
  if (unreachableWhere === null) return { audience: matching, unreachable: 0 }
  const unreachable = await prisma.pushRegistration.count({
    where: unreachableWhere,
  })
  return { audience: matching - unreachable, unreachable }
}
