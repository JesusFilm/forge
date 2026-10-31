/**
 * R16 and KTD11 — the wave's shape in time.
 *
 * A group is one absolute instant. Zones that share an offset on the send date
 * share a group, so a wave has about forty groups rather than four hundred. A
 * zone the runtime cannot name is dropped: one unknown value from a phone must
 * not stop the wave.
 */
import {
  PushRegistrationStatus,
  type Prisma,
  type PrismaClient,
  type PushAudienceScope,
} from "@prisma/client"

import {
  canonicalizePushTimeZone,
  resolvePushZoneInstant,
} from "./zone-instant"

/** KTD11 — a group more than three hours past is missed, never sent late. */
export const PUSH_ZONE_LATE_LIMIT_MS = 3 * 60 * 60 * 1_000
/** IANA carries about 420 zones, so a campaign's zone read is naturally small. */
export const PUSH_ZONE_MAX_COUNT = 1_000

export type PushZoneGroup = Readonly<{
  instant: Date
  timeZones: string[]
}>

export type PushZoneRow = Readonly<{
  timeZone: string
  scheduledAt: Date
}>

export type PushZoneAudienceCount = Readonly<{
  timeZone: string
  registrations: number
}>

function sortedGroups(byInstant: Map<number, Set<string>>): PushZoneGroup[] {
  return [...byInstant.entries()]
    .sort(([left], [right]) => left - right)
    .map(([instant, timeZones]) => ({
      instant: new Date(instant),
      timeZones: [...timeZones].sort(),
    }))
}

/**
 * The instant groups for a scheduled campaign, recomputed from the zone names.
 *
 * The run calls this again immediately before it sleeps, so a zone database
 * update between scheduling and waking moves the group rather than sending at
 * the stale instant.
 */
export function resolvePushZoneGroups(input: {
  timeZones: readonly string[]
  sendDate: string
  localHour: number
}): PushZoneGroup[] {
  const byInstant = new Map<number, Set<string>>()
  for (const raw of input.timeZones) {
    let timeZone: string
    let instant: Date
    try {
      timeZone = canonicalizePushTimeZone(raw)
      instant = resolvePushZoneInstant({
        timeZone,
        sendDate: input.sendDate,
        localHour: input.localHour,
      })
    } catch {
      // A phone reported a zone this runtime cannot name. It is dropped from
      // the wave, and the audience read still counts it as a registration.
      continue
    }
    const key = instant.getTime()
    const zones = byInstant.get(key)
    if (zones) zones.add(timeZone)
    else byInstant.set(key, new Set([timeZone]))
  }
  return sortedGroups(byInstant)
}

/** The instant groups of the zone rows a campaign already persisted. */
export function groupPushZonesByInstant(
  rows: readonly PushZoneRow[],
): PushZoneGroup[] {
  const byInstant = new Map<number, Set<string>>()
  for (const row of rows) {
    const key = row.scheduledAt.getTime()
    const zones = byInstant.get(key)
    if (zones) zones.add(row.timeZone)
    else byInstant.set(key, new Set([row.timeZone]))
  }
  return sortedGroups(byInstant)
}

/** KTD11 — the lateness gate, checked at wake and before every later page. */
export function isPushZoneLate(
  instant: Date,
  now: Date = new Date(),
  limitMs: number = PUSH_ZONE_LATE_LIMIT_MS,
): boolean {
  return now.getTime() - instant.getTime() > limitMs
}

function audienceWhere(campaign: {
  audienceScope: PushAudienceScope
  countries: readonly string[]
  languageFilter: readonly string[]
}): Prisma.PushRegistrationWhereInput {
  const filter = [...campaign.languageFilter]
  return {
    status: PushRegistrationStatus.ACTIVE,
    ...(campaign.audienceScope === "COUNTRIES"
      ? { country: { in: [...campaign.countries] } }
      : {}),
    ...(filter.length > 0
      ? {
          OR: [
            { appLanguageSlug: { in: filter } },
            { phoneLanguageSlug: { in: filter } },
          ],
        }
      : {}),
  }
}

/**
 * The zones the campaign's audience reports, with a registration count each.
 *
 * The count is a snapshot for the campaign page; the send path always reads the
 * audience again page by page, so a phone that registers later still receives.
 */
export async function readPushCampaignZoneCounts(
  prisma: PrismaClient,
  campaign: {
    audienceScope: PushAudienceScope
    countries: readonly string[]
    languageFilter: readonly string[]
  },
): Promise<PushZoneAudienceCount[]> {
  const rows = await prisma.pushRegistration.groupBy({
    by: ["timeZone"],
    where: audienceWhere(campaign),
    _count: { _all: true },
  })
  return rows
    .map((row) => ({
      timeZone: row.timeZone,
      registrations: row._count._all,
    }))
    .sort((left, right) => left.timeZone.localeCompare(right.timeZone))
    .slice(0, PUSH_ZONE_MAX_COUNT)
}
