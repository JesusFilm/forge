/**
 * KTD10 — the reads the campaign dashboard needs and no other caller has.
 *
 * Nothing here writes. The send path owns every write, so a page that only
 * shows what is there cannot change it by accident.
 */
import {
  Prisma,
  type PrismaClient,
  type PushAudienceScope,
  type PushCampaignMode,
  type PushCampaignStatus,
  type PushDestinationKind,
} from "@prisma/client"

import {
  loadWorkflowWorkerStatusRows,
  type WorkflowWorkerStatusRow,
} from "@/services/workflow-worker-heartbeat.service"

import {
  pushExperienceDestinationWhere,
  pushVideoDestinationWhere,
} from "./destinations"
import { PUSH_ENGLISH_LANGUAGE_SLUG } from "./language-resolution"

export const PUSH_CAMPAIGN_LIST_LIMIT = 100
export const PUSH_REGISTRATION_TREND_DAYS = 14
export const PUSH_DESTINATION_SEARCH_LIMIT = 40
export const PUSH_LANGUAGE_OPTION_LIMIT = 2_000

/** The sentinel `loadWorkflowWorkerStatusRows` returns when the read fails. */
export const PUSH_WORKER_UNAVAILABLE_ROW_ID =
  "workflow-worker-heartbeat-unavailable"

/** The labels that service gives a worker it has heard from recently. */
const LIVE_WORKER_LABELS = new Set(["Online", "Running", "Processing"])

export type PushCampaignListRow = Readonly<{
  id: string
  status: PushCampaignStatus
  mode: PushCampaignMode
  englishTitle: string | null
  languageCount: number
  destinationKind: PushDestinationKind | null
  destinationSlug: string | null
  audienceScope: PushAudienceScope
  countries: readonly string[]
  languageFilter: readonly string[]
  sendDate: Date | null
  localHour: number | null
  testSentAt: Date | null
  sendingStartedAt: Date | null
  completedAt: Date | null
  updatedAt: Date
}>

/** Newest first, so the campaign an editor just made is the first row. */
export async function listPushCampaigns(
  prisma: PrismaClient,
  limit = PUSH_CAMPAIGN_LIST_LIMIT,
): Promise<PushCampaignListRow[]> {
  const rows = await prisma.pushCampaign.findMany({
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      status: true,
      mode: true,
      destinationKind: true,
      destinationSlug: true,
      audienceScope: true,
      countries: true,
      languageFilter: true,
      sendDate: true,
      localHour: true,
      testSentAt: true,
      sendingStartedAt: true,
      completedAt: true,
      updatedAt: true,
      copies: { select: { languageSlug: true, title: true } },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    mode: row.mode,
    englishTitle:
      row.copies.find(
        (copy) => copy.languageSlug === PUSH_ENGLISH_LANGUAGE_SLUG,
      )?.title ?? null,
    languageCount: row.copies.length,
    destinationKind: row.destinationKind,
    destinationSlug: row.destinationSlug,
    audienceScope: row.audienceScope,
    countries: row.countries,
    languageFilter: row.languageFilter,
    sendDate: row.sendDate,
    localHour: row.localHour,
    testSentAt: row.testSentAt,
    sendingStartedAt: row.sendingStartedAt,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt,
  }))
}

export type PushCampaignCopyRow = Readonly<{
  languageSlug: string
  title: string
  body: string
}>

export type PushCampaignDetail = PushCampaignListRow &
  Readonly<{
    copies: readonly PushCampaignCopyRow[]
    lastError: string | null
    createdAt: Date
  }>

/** What the editor and the send-now confirmation both read. */
export async function readPushCampaignDetail(
  prisma: PrismaClient,
  campaignId: string,
): Promise<PushCampaignDetail | null> {
  const row = await prisma.pushCampaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      status: true,
      mode: true,
      destinationKind: true,
      destinationSlug: true,
      audienceScope: true,
      countries: true,
      languageFilter: true,
      sendDate: true,
      localHour: true,
      testSentAt: true,
      sendingStartedAt: true,
      completedAt: true,
      lastError: true,
      createdAt: true,
      updatedAt: true,
      copies: {
        orderBy: { languageSlug: "asc" },
        select: { languageSlug: true, title: true, body: true },
      },
    },
  })
  if (row === null) return null

  const english = row.copies.find(
    (copy) => copy.languageSlug === PUSH_ENGLISH_LANGUAGE_SLUG,
  )
  return {
    id: row.id,
    status: row.status,
    mode: row.mode,
    englishTitle: english?.title ?? null,
    languageCount: row.copies.length,
    destinationKind: row.destinationKind,
    destinationSlug: row.destinationSlug,
    audienceScope: row.audienceScope,
    countries: row.countries,
    languageFilter: row.languageFilter,
    sendDate: row.sendDate,
    localHour: row.localHour,
    testSentAt: row.testSentAt,
    sendingStartedAt: row.sendingStartedAt,
    completedAt: row.completedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // English first, so the required row is always the top row in the editor.
    copies: [
      ...(english ? [english] : []),
      ...row.copies.filter(
        (copy) => copy.languageSlug !== PUSH_ENGLISH_LANGUAGE_SLUG,
      ),
    ],
  }
}

export type PushRegistrationDay = Readonly<{ day: string; count: number }>

type RegistrationDayRow = { day: Date | string; count: bigint | number }

function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * A day nobody registered on returns no row, and a gap in a trend reads as
 * missing data rather than as a real zero. Every day in the window is here.
 */
export function fillPushRegistrationDays(
  rows: readonly PushRegistrationDay[],
  options: { days: number; now: Date },
): PushRegistrationDay[] {
  const counts = new Map(rows.map((row) => [row.day, row.count]))
  const filled: PushRegistrationDay[] = []
  const end = Date.UTC(
    options.now.getUTCFullYear(),
    options.now.getUTCMonth(),
    options.now.getUTCDate(),
  )
  for (let offset = options.days - 1; offset >= 0; offset -= 1) {
    const day = utcDayKey(new Date(end - offset * 86_400_000))
    filled.push({ day, count: counts.get(day) ?? 0 })
  }
  return filled
}

/** R27 — one count of registered devices per UTC day, oldest day first. */
export async function readPushRegistrationsPerDay(
  prisma: PrismaClient,
  options: { days?: number; now?: Date } = {},
): Promise<PushRegistrationDay[]> {
  const days = options.days ?? PUSH_REGISTRATION_TREND_DAYS
  const now = options.now ?? new Date()
  const since = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
      (days - 1) * 86_400_000,
  )
  const rows = await prisma.$queryRaw<RegistrationDayRow[]>(Prisma.sql`
    SELECT (created_at AT TIME ZONE 'UTC')::date AS "day",
           count(*)::bigint AS "count"
    FROM push_registration
    WHERE created_at >= ${since}
    GROUP BY 1
    ORDER BY 1 ASC
  `)
  const measured = rows.map((row) => ({
    day: row.day instanceof Date ? utcDayKey(row.day) : String(row.day),
    count: Number(row.count),
  }))
  return fillPushRegistrationDays(measured, { days, now })
}

export type PushWorkerState = Readonly<{
  kind: "online" | "stale" | "unknown"
  workers: readonly WorkflowWorkerStatusRow[]
}>

/**
 * A campaign only sends while a worker is alive, so the page says which of
 * the three it is. Unknown is not stale: the heartbeat read itself failed.
 */
export function classifyPushWorkerState(
  rows: readonly WorkflowWorkerStatusRow[],
): PushWorkerState {
  const reported = rows.filter(
    (row) => row.id !== PUSH_WORKER_UNAVAILABLE_ROW_ID,
  )
  if (reported.length === 0) {
    return { kind: "unknown", workers: rows }
  }
  const live = reported.some((row) => LIVE_WORKER_LABELS.has(row.statusLabel))
  return { kind: live ? "online" : "stale", workers: reported }
}

export async function readPushWorkerState(): Promise<PushWorkerState> {
  return classifyPushWorkerState(await loadWorkflowWorkerStatusRows())
}

export type PushLanguageOption = Readonly<{ slug: string; label: string }>

/** The `{"en":"English"}` map Core syncs. Any name beats the bare slug. */
export function pushLanguageLabel(name: unknown, slug: string): string {
  if (typeof name !== "object" || name === null) return slug
  const names = name as Record<string, unknown>
  for (const key of ["en", "native"]) {
    const value = names[key]
    if (typeof value === "string" && value.trim() !== "") return value.trim()
  }
  const first = Object.values(names).find(
    (value): value is string =>
      typeof value === "string" && value.trim() !== "",
  )
  return first?.trim() ?? slug
}

/** R6 — the languages an editor may add a copy row for, English first. */
export async function listPushLanguageOptions(
  prisma: PrismaClient,
  limit = PUSH_LANGUAGE_OPTION_LIMIT,
): Promise<PushLanguageOption[]> {
  const rows = await prisma.language.findMany({
    where: { deletedAt: null, slug: { not: null } },
    take: limit,
    select: { slug: true, name: true },
  })
  const options = rows.flatMap((row) =>
    row.slug
      ? [{ slug: row.slug, label: pushLanguageLabel(row.name, row.slug) }]
      : [],
  )
  return options.sort((left, right) => {
    if (left.slug === PUSH_ENGLISH_LANGUAGE_SLUG) return -1
    if (right.slug === PUSH_ENGLISH_LANGUAGE_SLUG) return 1
    return left.label.localeCompare(right.label)
  })
}

export type PushDestinationOption = Readonly<{
  kind: PushDestinationKind
  slug: string
  title: string
  meta: string
}>

/** A collection is a series to a viewer, so both labels answer SERIES. */

function videoTitle(
  locales: readonly { title: string | null }[],
  slug: string,
): string {
  return locales.find((locale) => locale.title?.trim())?.title?.trim() ?? slug
}

/**
 * R7 — the catalog behind the destination picker. The search runs in Postgres
 * so the page never loads the whole video catalog to filter it in a browser.
 */
export async function searchPushDestinations(
  prisma: PrismaClient,
  input: {
    kind: PushDestinationKind
    query?: string
    limit?: number
  },
): Promise<PushDestinationOption[]> {
  const take = input.limit ?? PUSH_DESTINATION_SEARCH_LIMIT
  const query = input.query?.trim() ?? ""

  if (input.kind === "EXPERIENCE") {
    const rows = await prisma.experienceLocale.findMany({
      where: {
        ...pushExperienceDestinationWhere(),
        ...(query
          ? {
              OR: [
                { slug: { contains: query, mode: "insensitive" } },
                { title: { contains: query, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take,
      select: { slug: true, title: true, locale: true },
    })
    return rows.map((row) => ({
      kind: "EXPERIENCE" as const,
      slug: row.slug,
      title: row.title?.trim() || row.slug,
      meta: `${row.slug} • ${row.locale}`,
    }))
  }

  const rows = await prisma.video.findMany({
    where: {
      // Published and not watch-restricted: a draft picked here would open the
      // not-found screen on every phone the campaign reaches.
      ...pushVideoDestinationWhere(input.kind),
      ...(query
        ? {
            OR: [
              { slug: { contains: query, mode: "insensitive" } },
              {
                locales: {
                  some: { title: { contains: query, mode: "insensitive" } },
                },
              },
            ],
          }
        : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take,
    select: {
      slug: true,
      label: true,
      locales: {
        where: { locale: "en" },
        select: { title: true },
        take: 1,
      },
    },
  })
  return rows.map((row) => ({
    kind: input.kind,
    slug: row.slug,
    title: videoTitle(row.locales, row.slug),
    meta: `${row.slug} • ${row.label ?? "video"}`,
  }))
}

/**
 * The human title beside a chosen destination. The search matches by substring,
 * so only an exact slug answers: a near-miss title would misname the target.
 */
export async function readPushDestinationTitle(
  prisma: PrismaClient,
  destination: { kind: PushDestinationKind | null; slug: string | null },
): Promise<string | null> {
  if (!destination.kind || !destination.slug) return null
  const found = await searchPushDestinations(prisma, {
    kind: destination.kind,
    query: destination.slug,
    limit: 10,
  })
  return found.find((row) => row.slug === destination.slug)?.title ?? null
}
