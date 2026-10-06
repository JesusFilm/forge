/**
 * R5–R8 — what the agent reads before it drafts a campaign: languages,
 * destinations, audience counts, and campaigns, with the same facts the
 * dashboard and the send path use.
 *
 * Every read is bounded. Names, titles, and copy in these results are content
 * that people wrote, so a caller passes them on as data, never as instructions.
 *
 * KTD14 — this module is on the agent path, so it never sends. It imports
 * nothing from `dispatch.ts`, `campaign.service.ts`, or the workflows.
 */
import type {
  Prisma,
  PrismaClient,
  PushCampaignMode,
  PushCampaignStatus,
  PushDestinationKind,
} from "@prisma/client"

import { env } from "@/config/env"

import {
  pushAudienceWhere,
  pushUnreachableWhere,
  type PushAudienceQuery,
} from "./audience.service"
import {
  isPushCampaignEditable,
  type PushCampaignAiMarker,
  type PushCampaignAudience,
  type PushCampaignCopy,
  type PushCampaignDestination,
} from "./campaign-content.service"
import {
  pushVideoKindOfLabel,
  pushVideoKindWhere,
  readPushDestinationStates,
  type PushDestinationState,
  type PushDestinationUnpublishedReason,
} from "./destinations"
import { PushInputError } from "./errors"
import { PUSH_ENGLISH_LANGUAGE_SLUG } from "./language-resolution"
import { readPushTestRunState, type PushTestRunState } from "./test-run-state"

/** KTD8 — a name search returns at most this many languages. */
export const PUSH_AGENT_LANGUAGE_SEARCH_LIMIT = 25
/** KTD9 — a destination search returns at most this many destinations. */
export const PUSH_AGENT_DESTINATION_SEARCH_LIMIT = 20
/** R8 — the campaign list's default page and its largest page. */
export const PUSH_AGENT_CAMPAIGN_LIST_LIMIT = 20
export const PUSH_AGENT_CAMPAIGN_LIST_MAX_LIMIT = 50

export type PushAgentLanguage = Readonly<{
  slug: string
  englishName: string | null
  nativeName: string | null
  bcp47: string | null
}>

/** A name search, or an exact lookup of slugs. */
export type PushAgentLanguageQuery =
  | Readonly<{ q: string }>
  | Readonly<{ slugs: readonly string[] }>

export type PushAgentLanguageSearchResult = Readonly<{
  languages: PushAgentLanguage[]
  /** The asked slugs that name no known language. Empty for a name search. */
  unknown: string[]
  /** True when a name search matched more languages than the cap. */
  truncated: boolean
}>

export type PushAgentDestinationQuery = Readonly<{
  q: string
  /** Omitted searches videos, series, and experiences. */
  kind?: PushDestinationKind
}>

export type PushAgentDestination = Readonly<{
  kind: PushDestinationKind
  slug: string
  title: string | null
  published: boolean
  reason: PushDestinationUnpublishedReason | null
}>

export type PushAgentDestinationSearchResult = Readonly<{
  destinations: PushAgentDestination[]
  /** True when the search matched more destinations than the cap. */
  truncated: boolean
}>

export type PushAgentAppLanguageCount = Readonly<{
  slug: string
  /** Null when the slug names no known language. */
  name: string | null
  count: number
}>

/** KTD10 — counts only; no field here describes one device. */
export type PushAgentAudienceCounts = Readonly<{
  /** Equals `countPushAudience(...).audience` for the same query. */
  total: number
  /** Android devices in a blocked country, outside `total`, as the dashboard counts them. */
  unreachable: number
  /** Reachable devices per app language, most first; the counts sum to `total`. */
  byAppLanguage: PushAgentAppLanguageCount[]
}>

export type PushAgentCampaignListQuery = Readonly<{
  statuses?: readonly PushCampaignStatus[]
  /** Matches the English title, in any case. */
  q?: string
  limit?: number
}>

export type PushAgentCampaignListRow = Readonly<{
  campaignId: string
  status: PushCampaignStatus
  revision: number
  englishTitle: string | null
  languageCount: number
  destination: PushCampaignDestination | null
  aiMarker: PushCampaignAiMarker | null
  createdAt: Date
  updatedAt: Date
}>

export type PushAgentCampaignList = Readonly<{
  campaigns: PushAgentCampaignListRow[]
  /** True when more campaigns match than the page holds. */
  truncated: boolean
}>

export type PushAgentCampaignQuery = Readonly<{
  campaignId: string
  /** Omitted returns every copy row. */
  languages?: readonly string[]
}>

/** KTD13 — `exists: false` is the stored destination with no live row. */
export type PushAgentCampaignDestination = Readonly<{
  kind: PushDestinationKind
  slug: string
  exists: boolean
  published: boolean
  reason: PushDestinationUnpublishedReason | null
}>

export type PushAgentCampaignSchedule = Readonly<{
  mode: PushCampaignMode
  /** The local calendar date, `YYYY-MM-DD`. */
  sendDate: string | null
  localHour: number | null
}>

export type PushAgentCampaign = Readonly<{
  campaignId: string
  status: PushCampaignStatus
  /** The content version a write must carry back. */
  revision: number
  editable: boolean
  /** Whether `PUSH_CAMPAIGNS_ENABLED` lets admin test, schedule, or send. */
  sendingEnabled: boolean
  /** Every copy row's language, whatever `languages` asked for. */
  languages: string[]
  copies: PushCampaignCopy[]
  destination: PushAgentCampaignDestination | null
  audience: PushCampaignAudience
  test: PushTestRunState
  aiMarker: PushCampaignAiMarker | null
  /** Null while the campaign is DRAFT or TESTED (KTD21). */
  schedule: PushAgentCampaignSchedule | null
  createdAt: Date
  updatedAt: Date
}>

/** KTD8 — the known-language rule the content write also applies. */
const KNOWN_LANGUAGE = {
  deletedAt: null,
  slug: { not: null },
} satisfies Prisma.LanguageWhereInput

const LANGUAGE_SELECT = {
  slug: true,
  bcp47: true,
  name: true,
} satisfies Prisma.LanguageSelect

type LanguageRow = Prisma.LanguageGetPayload<{
  select: typeof LANGUAGE_SELECT
}>

/** Core syncs `name` as a map from a BCP-47 tag to the name in that language. */
function nameAt(name: Prisma.JsonValue, key: string | null): string | null {
  if (key === null) return null
  if (typeof name !== "object" || name === null || Array.isArray(name)) {
    return null
  }
  const value = name[key]
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null
}

function toLanguage(row: LanguageRow): PushAgentLanguage[] {
  if (row.slug === null) return []
  return [
    {
      slug: row.slug,
      englishName: nameAt(row.name, "en"),
      nativeName: nameAt(row.name, row.bcp47),
      bcp47: row.bcp47,
    },
  ]
}

/**
 * R5 and KTD8 — finds languages in the `Language` table itself, so a language
 * the dashboard picker's 2,000-row read misses is still found.
 */
export async function searchPushAgentLanguages(
  prisma: PrismaClient,
  query: PushAgentLanguageQuery,
): Promise<PushAgentLanguageSearchResult> {
  if ("slugs" in query) {
    const slugs = [...new Set(query.slugs)]
    const rows =
      slugs.length === 0
        ? []
        : await prisma.language.findMany({
            where: { ...KNOWN_LANGUAGE, slug: { in: slugs } },
            select: LANGUAGE_SELECT,
          })
    const bySlug = new Map(
      rows.flatMap(toLanguage).map((language) => [language.slug, language]),
    )
    return {
      languages: slugs.flatMap((slug) => bySlug.get(slug) ?? []),
      unknown: slugs.filter((slug) => !bySlug.has(slug)),
      truncated: false,
    }
  }

  const q = query.q.trim()
  const rows = await prisma.language.findMany({
    where: {
      ...KNOWN_LANGUAGE,
      OR: [
        { name: { path: ["en"], string_contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: { slug: "asc" },
    take: PUSH_AGENT_LANGUAGE_SEARCH_LIMIT + 1,
    select: LANGUAGE_SELECT,
  })
  return {
    languages: rows
      .slice(0, PUSH_AGENT_LANGUAGE_SEARCH_LIMIT)
      .flatMap(toLanguage),
    unknown: [],
    truncated: rows.length > PUSH_AGENT_LANGUAGE_SEARCH_LIMIT,
  }
}

type FoundDestination = {
  kind: PushDestinationKind
  slug: string
  title: string | null
  updatedAt: Date
}

type FoundPage = Readonly<{ found: FoundDestination[]; more: boolean }>

function trimmed(value: string | null | undefined): string | null {
  return value?.trim() || null
}

async function findVideoDestinations(
  prisma: PrismaClient,
  kinds: ReadonlyArray<"VIDEO" | "SERIES">,
  q: string,
): Promise<FoundPage> {
  if (kinds.length === 0) return { found: [], more: false }
  const rows = await prisma.video.findMany({
    where: {
      AND: [
        // The kind predicates carry `deletedAt: null`, so a deleted video is
        // never found.
        { OR: kinds.map(pushVideoKindWhere) },
        q
          ? {
              OR: [
                { slug: { contains: q, mode: "insensitive" } },
                {
                  locales: {
                    some: { title: { contains: q, mode: "insensitive" } },
                  },
                },
              ],
            }
          : {},
      ],
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: PUSH_AGENT_DESTINATION_SEARCH_LIMIT + 1,
    select: {
      slug: true,
      label: true,
      updatedAt: true,
      locales: { where: { locale: "en" }, select: { title: true }, take: 1 },
    },
  })
  return {
    found: rows.map((row) => ({
      kind: row.label === null ? "VIDEO" : pushVideoKindOfLabel(row.label),
      slug: row.slug,
      title: trimmed(row.locales[0]?.title),
      updatedAt: row.updatedAt,
    })),
    more: rows.length > PUSH_AGENT_DESTINATION_SEARCH_LIMIT,
  }
}

/** One result per slug: a tap opens the slug, whatever its locale. */
async function findExperienceDestinations(
  prisma: PrismaClient,
  q: string,
): Promise<FoundPage> {
  const rows = await prisma.experienceLocale.findMany({
    where: q
      ? {
          OR: [
            { slug: { contains: q, mode: "insensitive" } },
            { title: { contains: q, mode: "insensitive" } },
          ],
        }
      : {},
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: PUSH_AGENT_DESTINATION_SEARCH_LIMIT + 1,
    select: { slug: true, title: true, locale: true, updatedAt: true },
  })
  const bySlug = new Map<string, FoundDestination>()
  for (const row of rows) {
    const title = trimmed(row.title)
    const found = bySlug.get(row.slug)
    if (!found) {
      bySlug.set(row.slug, {
        kind: "EXPERIENCE",
        slug: row.slug,
        title,
        updatedAt: row.updatedAt,
      })
    } else if (row.locale === "en" && title) {
      found.title = title
    }
  }
  return {
    found: [...bySlug.values()],
    more: rows.length > PUSH_AGENT_DESTINATION_SEARCH_LIMIT,
  }
}

function stateKey(kind: PushDestinationKind, slug: string): string {
  return `${kind}:${slug}`
}

async function readStates(
  prisma: PrismaClient,
  found: readonly FoundDestination[],
): Promise<Map<string, PushDestinationState>> {
  const kinds: PushDestinationKind[] = ["VIDEO", "SERIES", "EXPERIENCE"]
  const perKind = await Promise.all(
    kinds.map(async (kind) => {
      const slugs = found
        .filter((row) => row.kind === kind)
        .map((row) => row.slug)
      const states = await readPushDestinationStates(prisma, kind, slugs)
      return [...states].map(
        ([slug, state]) => [stateKey(kind, slug), state] as const,
      )
    }),
  )
  return new Map(perKind.flat())
}

/**
 * R6 and KTD9 — finds videos, series, and experiences, published or not. The
 * `published` flag comes from the send path's own predicate (a second read
 * over the found slugs), and an unpublished result names its reason.
 */
export async function searchPushAgentDestinations(
  prisma: PrismaClient,
  query: PushAgentDestinationQuery,
): Promise<PushAgentDestinationSearchResult> {
  const q = query.q.trim()
  const videoKinds = (["VIDEO", "SERIES"] as const).filter(
    (kind) => query.kind === undefined || query.kind === kind,
  )
  const searchesExperiences =
    query.kind === undefined || query.kind === "EXPERIENCE"
  const [videos, experiences] = await Promise.all([
    findVideoDestinations(prisma, videoKinds, q),
    searchesExperiences
      ? findExperienceDestinations(prisma, q)
      : { found: [], more: false },
  ])

  const found = [...videos.found, ...experiences.found].sort(
    (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
  )
  const page = found.slice(0, PUSH_AGENT_DESTINATION_SEARCH_LIMIT)
  const states = await readStates(prisma, page)
  return {
    destinations: page.map((row) => {
      const state = states.get(stateKey(row.kind, row.slug))
      return {
        kind: row.kind,
        slug: row.slug,
        title: row.title,
        published: state?.published ?? false,
        reason: state?.reason ?? null,
      }
    }),
    truncated: found.length > page.length || videos.more || experiences.more,
  }
}

async function countByAppLanguage(
  prisma: PrismaClient,
  where: Prisma.PushRegistrationWhereInput,
): Promise<Map<string, number>> {
  const rows = await prisma.pushRegistration.groupBy({
    by: ["appLanguageSlug"],
    where,
    _count: { _all: true },
  })
  return new Map(rows.map((row) => [row.appLanguageSlug, row._count._all]))
}

async function knownLanguageNames(
  prisma: PrismaClient,
  slugs: readonly string[],
): Promise<Map<string, string | null>> {
  if (slugs.length === 0) return new Map()
  const rows = await prisma.language.findMany({
    where: { ...KNOWN_LANGUAGE, slug: { in: [...slugs] } },
    select: LANGUAGE_SELECT,
  })
  return new Map(
    rows
      .flatMap(toLanguage)
      .map((language) => [
        language.slug,
        language.englishName ?? language.nativeName,
      ]),
  )
}

function sum(values: Iterable<number>): number {
  let total = 0
  for (const value of values) total += value
  return total
}

/**
 * R7 and KTD10 — the audience's reachable devices per app language. It reads
 * the dashboard's audience and unreachable predicates and subtracts as
 * `countPushAudience` does, so `total` equals that function's `audience`.
 */
export async function countPushAgentAudience(
  prisma: PrismaClient,
  query: PushAudienceQuery,
): Promise<PushAgentAudienceCounts> {
  const unreachableWhere = pushUnreachableWhere(query)
  const [matching, unreachable] = await Promise.all([
    countByAppLanguage(prisma, pushAudienceWhere(query)),
    unreachableWhere === null
      ? new Map<string, number>()
      : countByAppLanguage(prisma, unreachableWhere),
  ])
  const reachable = [...matching]
    .map(([slug, count]) => ({
      slug,
      count: count - (unreachable.get(slug) ?? 0),
    }))
    .filter((entry) => entry.count > 0)
  const names = await knownLanguageNames(
    prisma,
    reachable.map((entry) => entry.slug),
  )
  const byAppLanguage = reachable
    .map((entry) => ({
      slug: entry.slug,
      name: names.get(entry.slug) ?? null,
      count: entry.count,
    }))
    .sort(
      (left, right) =>
        right.count - left.count || (left.slug < right.slug ? -1 : 1),
    )
  return {
    total: sum(byAppLanguage.map((entry) => entry.count)),
    unreachable: sum(unreachable.values()),
    byAppLanguage,
  }
}

function aiMarkerOf(row: {
  aiLastActorId: string | null
  aiLastWrittenAt: Date | null
}): PushCampaignAiMarker | null {
  return row.aiLastActorId && row.aiLastWrittenAt
    ? { actorId: row.aiLastActorId, writtenAt: row.aiLastWrittenAt }
    : null
}

function destinationOf(row: {
  destinationKind: PushDestinationKind | null
  destinationSlug: string | null
}): PushCampaignDestination | null {
  return row.destinationKind && row.destinationSlug
    ? { kind: row.destinationKind, slug: row.destinationSlug }
    : null
}

function listLimit(limit: number | undefined): number {
  const value = limit ?? PUSH_AGENT_CAMPAIGN_LIST_LIMIT
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > PUSH_AGENT_CAMPAIGN_LIST_MAX_LIMIT
  ) {
    throw new PushInputError(`The campaign list limit ${value} is invalid`)
  }
  return value
}

/**
 * R8 — campaigns newest first by creation. `q` matches the English title,
 * which is the title the dashboard list shows.
 */
export async function listPushAgentCampaigns(
  prisma: PrismaClient,
  query: PushAgentCampaignListQuery = {},
): Promise<PushAgentCampaignList> {
  const take = listLimit(query.limit)
  const q = query.q?.trim() ?? ""
  const rows = await prisma.pushCampaign.findMany({
    where: {
      ...(query.statuses && query.statuses.length > 0
        ? { status: { in: [...query.statuses] } }
        : {}),
      ...(q
        ? {
            copies: {
              some: {
                languageSlug: PUSH_ENGLISH_LANGUAGE_SLUG,
                title: { contains: q, mode: "insensitive" },
              },
            },
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    select: {
      id: true,
      status: true,
      contentVersion: true,
      destinationKind: true,
      destinationSlug: true,
      aiLastActorId: true,
      aiLastWrittenAt: true,
      createdAt: true,
      updatedAt: true,
      copies: {
        where: { languageSlug: PUSH_ENGLISH_LANGUAGE_SLUG },
        select: { title: true },
        take: 1,
      },
      _count: { select: { copies: true } },
    },
  })
  return {
    campaigns: rows.slice(0, take).map((row) => ({
      campaignId: row.id,
      status: row.status,
      revision: row.contentVersion,
      englishTitle: row.copies[0]?.title ?? null,
      languageCount: row._count.copies,
      destination: destinationOf(row),
      aiMarker: aiMarkerOf(row),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    truncated: rows.length > take,
  }
}

async function readCampaignDestination(
  prisma: PrismaClient,
  destination: PushCampaignDestination | null,
): Promise<PushAgentCampaignDestination | null> {
  if (destination === null) return null
  const states = await readPushDestinationStates(prisma, destination.kind, [
    destination.slug,
  ])
  const state = states.get(destination.slug)
  return {
    kind: destination.kind,
    slug: destination.slug,
    exists: state !== undefined,
    published: state?.published ?? false,
    reason: state?.reason ?? null,
  }
}

/**
 * R8 and KTD21 — one campaign as the agent edits it. The editable statuses are
 * DRAFT and TESTED, and a TESTED campaign can still carry the schedule of a
 * failed start, so the schedule is returned only once the campaign leaves them.
 */
export async function readPushAgentCampaign(
  prisma: PrismaClient,
  query: PushAgentCampaignQuery,
): Promise<PushAgentCampaign | null> {
  const row = await prisma.pushCampaign.findUnique({
    where: { id: query.campaignId },
    select: {
      id: true,
      status: true,
      contentVersion: true,
      mode: true,
      sendDate: true,
      localHour: true,
      destinationKind: true,
      destinationSlug: true,
      audienceScope: true,
      countries: true,
      languageFilter: true,
      aiLastActorId: true,
      aiLastWrittenAt: true,
      createdAt: true,
      updatedAt: true,
      copies: {
        orderBy: { languageSlug: "asc" },
        select: { languageSlug: true, title: true, body: true },
      },
    },
  })
  if (row === null) return null

  const [destination, test] = await Promise.all([
    readCampaignDestination(prisma, destinationOf(row)),
    readPushTestRunState(prisma, row.id),
  ])
  const asked = query.languages ? new Set(query.languages) : null
  const editable = isPushCampaignEditable(row.status)
  return {
    campaignId: row.id,
    status: row.status,
    revision: row.contentVersion,
    editable,
    sendingEnabled: env.PUSH_CAMPAIGNS_ENABLED === "true",
    languages: row.copies.map((copy) => copy.languageSlug),
    copies: asked
      ? row.copies.filter((copy) => asked.has(copy.languageSlug))
      : row.copies,
    destination,
    audience: {
      scope: row.audienceScope,
      countries: row.countries,
      languageFilter: row.languageFilter,
    },
    test,
    aiMarker: aiMarkerOf(row),
    schedule: editable
      ? null
      : {
          mode: row.mode,
          sendDate: row.sendDate?.toISOString().slice(0, 10) ?? null,
          localHour: row.localHour,
        },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
