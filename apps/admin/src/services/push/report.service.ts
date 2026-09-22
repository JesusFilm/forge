/**
 * R25, R26, and R27 — one campaign's outcome, split by language and country.
 *
 * Every number is a count of devices, taken from push-owned rows alone: live
 * delivery rows, the opens they earned, and the watch starts those opens
 * attributed. A device is its registration, so one viewer who has a phone and
 * a tablet counts twice, once for each device the campaign reached.
 *
 * The report re-aggregates on every read, in every status, and holds no cache:
 * opens and attributed watch starts keep arriving for about a day after the
 * last group, so a stored total is wrong within the hour (KTD10). Each read is
 * one aggregate statement per source, never a row scan.
 */
import {
  Prisma,
  type PushCampaignStatus,
  type PrismaClient,
} from "@prisma/client"

import { PushNotFoundError } from "./errors"

/**
 * The key a slice carries when the rows have no language or no country. A
 * Language slug is a lowercase name and a country is a two-letter ISO code, so
 * neither can spell this.
 */
export const PUSH_REPORT_UNKNOWN_KEY = "(unknown)"

/**
 * The DB literals migration 0099 mapped the delivery enums onto. A bound
 * parameter arrives as text and Postgres has no `enum = text` operator, so the
 * SQL below casts the column; `report.service.db.test.ts` proves each literal.
 */
const STATUS = {
  reserved: "reserved",
  sending: "sending",
  accepted: "accepted",
  handedOff: "handed_off",
  unknown: "unknown",
  failed: "failed",
  invalid: "invalid",
  suppressed: "suppressed",
  unreachable: "unreachable",
  missed: "missed",
} as const

export type PushReportCounts = Readonly<{
  /** Every device the campaign reserved a row for, reachable or not (R26). */
  audience: number
  accepted: number
  handedOff: number
  /** The provider may have taken these; the receipt never said (KTD3). */
  unknown: number
  /** Reserved or sending, so the group has not finished. */
  pending: number
  failed: number
  /** A token the provider called dead. The first campaign expects zero. */
  invalid: number
  suppressed: number
  unreachable: number
  missed: number
  opened: number
  /** Devices with at least one attributed watch start (R27). */
  attributed: number
  /** The watch starts themselves, which one device can have several of. */
  attributedWatchStarts: number
}>

export type PushReportSlice = Readonly<{
  key: string
  counts: PushReportCounts
}>

export type PushCampaignReport = Readonly<{
  campaignId: string
  status: PushCampaignStatus
  sendingStartedAt: Date | null
  completedAt: Date | null
  generatedAt: Date
  totals: PushReportCounts
  byLanguage: PushReportSlice[]
  byCountry: PushReportSlice[]
}>

type GroupedRow = {
  lang_total: number
  country_total: number
  language_slug: string | null
  country: string | null
}

type DeliveryRow = GroupedRow & {
  audience: bigint
  accepted: bigint
  handed_off: bigint
  unknown_count: bigint
  pending: bigint
  failed: bigint
  invalid: bigint
  suppressed: bigint
  unreachable: bigint
  missed: bigint
}

type OpenRow = GroupedRow & { opened: bigint }

type AttributionRow = GroupedRow & {
  attributed: bigint
  watch_starts: bigint
}

type MutableCounts = { -readonly [K in keyof PushReportCounts]: number }

function zero(): MutableCounts {
  return {
    audience: 0,
    accepted: 0,
    handedOff: 0,
    unknown: 0,
    pending: 0,
    failed: 0,
    invalid: 0,
    suppressed: 0,
    unreachable: 0,
    missed: 0,
    opened: 0,
    attributed: 0,
    attributedWatchStarts: 0,
  }
}

function count(value: unknown): number {
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "number") return value
  if (typeof value === "string") return Number.parseInt(value, 10) || 0
  return 0
}

/** Where one aggregate row belongs: the whole campaign, a language, a country. */
type Dimension = "totals" | "language" | "country"

function dimensionOf(row: GroupedRow): Dimension {
  if (row.lang_total === 1 && row.country_total === 1) return "totals"
  return row.lang_total === 0 ? "language" : "country"
}

function keyOf(row: GroupedRow, dimension: Dimension): string {
  const value = dimension === "language" ? row.language_slug : row.country
  return value == null || value === "" ? PUSH_REPORT_UNKNOWN_KEY : value
}

class ReportAccumulator {
  readonly totals = zero()
  private readonly languages = new Map<string, MutableCounts>()
  private readonly countries = new Map<string, MutableCounts>()

  bucket(row: GroupedRow): MutableCounts {
    const dimension = dimensionOf(row)
    if (dimension === "totals") return this.totals
    const key = keyOf(row, dimension)
    const map = dimension === "language" ? this.languages : this.countries
    const existing = map.get(key)
    if (existing) return existing
    const fresh = zero()
    map.set(key, fresh)
    return fresh
  }

  slices(dimension: "language" | "country"): PushReportSlice[] {
    const map = dimension === "language" ? this.languages : this.countries
    return [...map.entries()]
      .map(([key, counts]) => ({ key, counts }))
      .sort((left, right) => {
        // The no-language and no-country slices read last.
        if (left.key === PUSH_REPORT_UNKNOWN_KEY) return 1
        if (right.key === PUSH_REPORT_UNKNOWN_KEY) return -1
        return left.key.localeCompare(right.key)
      })
  }
}

const GROUPING_SETS = (language: Prisma.Sql, country: Prisma.Sql): Prisma.Sql =>
  Prisma.sql`GROUP BY GROUPING SETS ((), (${language}), (${country}))`

/**
 * The counted identity is one device, which is one registration. A live
 * delivery row is unique per campaign and registration, so a purged
 * registration still counts once through the row that reached the device.
 *
 * Within `campaign_id = $1 AND kind = 'live'`, the partial unique index
 * `push_delivery_campaign_registration_live_key` makes one delivery row per
 * device, and a purged row falls back to its own primary key, so the delivery
 * and open counts need no DISTINCT. Restore it if that index ever goes.
 */
const DEVICE = {
  attribution: Prisma.sql`COALESCE(a.registration_id, o.delivery_id)`,
} as const

function deliveryQuery(campaignId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT
      GROUPING(d.language_slug) AS lang_total,
      GROUPING(d.country) AS country_total,
      d.language_slug AS language_slug,
      d.country AS country,
      COUNT(*) AS audience,
      COUNT(*) FILTER (WHERE d.status::text = ${STATUS.accepted}) AS accepted,
      COUNT(*) FILTER (WHERE d.status::text = ${STATUS.handedOff}) AS handed_off,
      COUNT(*) FILTER (WHERE d.status::text = ${STATUS.unknown}) AS unknown_count,
      COUNT(*) FILTER (
        WHERE d.status::text IN (${STATUS.reserved}, ${STATUS.sending})
      ) AS pending,
      COUNT(*) FILTER (WHERE d.status::text = ${STATUS.failed}) AS failed,
      COUNT(*) FILTER (WHERE d.status::text = ${STATUS.invalid}) AS invalid,
      COUNT(*) FILTER (WHERE d.status::text = ${STATUS.suppressed}) AS suppressed,
      COUNT(*) FILTER (WHERE d.status::text = ${STATUS.unreachable}) AS unreachable,
      COUNT(*) FILTER (WHERE d.status::text = ${STATUS.missed}) AS missed
    FROM push_delivery d
    WHERE d.campaign_id = ${campaignId}
      AND d.kind = 'live'
    ${GROUPING_SETS(Prisma.sql`d.language_slug`, Prisma.sql`d.country`)}
  `
}

function openQuery(campaignId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT
      GROUPING(o.language_slug) AS lang_total,
      GROUPING(o.country) AS country_total,
      o.language_slug AS language_slug,
      o.country AS country,
      COUNT(*) AS opened
    FROM push_open o
    JOIN push_delivery d ON d.id = o.delivery_id
    WHERE o.campaign_id = ${campaignId}
      AND d.kind = 'live'
    ${GROUPING_SETS(Prisma.sql`o.language_slug`, Prisma.sql`o.country`)}
  `
}

function attributionQuery(campaignId: string): Prisma.Sql {
  // The join through the open keeps a test send out: an attribution carries no
  // kind of its own. `open_id` is required and cascades, so no row is lost,
  // and the open carries the delivery that identifies the device.
  return Prisma.sql`
    SELECT
      GROUPING(a.language_slug) AS lang_total,
      GROUPING(a.country) AS country_total,
      a.language_slug AS language_slug,
      a.country AS country,
      COUNT(DISTINCT ${DEVICE.attribution}) AS attributed,
      COUNT(*) AS watch_starts
    FROM push_attribution a
    JOIN push_open o ON o.id = a.open_id
    JOIN push_delivery d ON d.id = o.delivery_id
    WHERE a.campaign_id = ${campaignId}
      AND d.kind = 'live'
    ${GROUPING_SETS(Prisma.sql`a.language_slug`, Prisma.sql`a.country`)}
  `
}

export async function readPushCampaignReport(
  prisma: PrismaClient,
  campaignId: string,
  options: { now?: () => Date } = {},
): Promise<PushCampaignReport> {
  const campaign = await prisma.pushCampaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      status: true,
      sendingStartedAt: true,
      completedAt: true,
    },
  })
  if (campaign === null) {
    throw new PushNotFoundError(`No push campaign ${campaignId}`)
  }

  const [deliveries, opens, attributions] = await Promise.all([
    prisma.$queryRaw<DeliveryRow[]>(deliveryQuery(campaignId)),
    prisma.$queryRaw<OpenRow[]>(openQuery(campaignId)),
    prisma.$queryRaw<AttributionRow[]>(attributionQuery(campaignId)),
  ])

  const accumulator = new ReportAccumulator()
  for (const row of deliveries) {
    const bucket = accumulator.bucket(row)
    bucket.audience += count(row.audience)
    bucket.accepted += count(row.accepted)
    bucket.handedOff += count(row.handed_off)
    bucket.unknown += count(row.unknown_count)
    bucket.pending += count(row.pending)
    bucket.failed += count(row.failed)
    bucket.invalid += count(row.invalid)
    bucket.suppressed += count(row.suppressed)
    bucket.unreachable += count(row.unreachable)
    bucket.missed += count(row.missed)
  }
  for (const row of opens) {
    accumulator.bucket(row).opened += count(row.opened)
  }
  for (const row of attributions) {
    const bucket = accumulator.bucket(row)
    bucket.attributed += count(row.attributed)
    bucket.attributedWatchStarts += count(row.watch_starts)
  }

  return {
    campaignId: campaign.id,
    status: campaign.status,
    sendingStartedAt: campaign.sendingStartedAt,
    completedAt: campaign.completedAt,
    generatedAt: options.now?.() ?? new Date(),
    totals: accumulator.totals,
    byLanguage: accumulator.slices("language"),
    byCountry: accumulator.slices("country"),
  }
}
