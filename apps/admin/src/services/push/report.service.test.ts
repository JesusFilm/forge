import { describe, expect, it, vi } from "vitest"

import { PushNotFoundError } from "./errors"
import {
  PUSH_REPORT_UNKNOWN_KEY,
  readPushCampaignReport,
  type PushReportCounts,
} from "./report.service"

const CAMPAIGN = "campaign_1"
const SENDING_AT = new Date("2026-10-01T20:00:00.000Z")

type Row = Record<string, unknown>

/** A delivery aggregate row, in the column names the SQL returns. */
function deliveryRow(overrides: Row = {}): Row {
  return {
    lang_total: 1,
    country_total: 1,
    language_slug: null,
    country: null,
    audience: 0n,
    accepted: 0n,
    handed_off: 0n,
    unknown_count: 0n,
    pending: 0n,
    failed: 0n,
    invalid: 0n,
    suppressed: 0n,
    unreachable: 0n,
    missed: 0n,
    ...overrides,
  }
}

function openRow(overrides: Row = {}): Row {
  return {
    lang_total: 1,
    country_total: 1,
    language_slug: null,
    country: null,
    opened: 0n,
    ...overrides,
  }
}

function attributionRow(overrides: Row = {}): Row {
  return {
    lang_total: 1,
    country_total: 1,
    language_slug: null,
    country: null,
    attributed: 0n,
    watch_starts: 0n,
    ...overrides,
  }
}

function buildPrisma(
  options: {
    campaign?: Row | null
    deliveries?: Row[]
    opens?: Row[]
    attributions?: Row[]
  } = {},
) {
  const pages = [
    options.deliveries ?? [],
    options.opens ?? [],
    options.attributions ?? [],
  ]
  let call = 0
  const queries: unknown[] = []
  const client = {
    pushCampaign: {
      findUnique: vi.fn(async () =>
        options.campaign === undefined
          ? {
              id: CAMPAIGN,
              status: "SENT",
              sendingStartedAt: SENDING_AT,
              completedAt: null,
            }
          : options.campaign,
      ),
    },
    $queryRaw: vi.fn(async (query: unknown) => {
      queries.push(query)
      return pages[call++] ?? []
    }),
  }
  return { client, queries }
}

function sqlText(query: unknown): string {
  const sql = query as { strings?: readonly string[] }
  return (sql.strings ?? []).join(" ")
}

const ZERO: PushReportCounts = {
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

describe("reading one campaign's report", () => {
  it("refuses a campaign that does not exist, before it aggregates", async () => {
    const { client } = buildPrisma({ campaign: null })
    await expect(
      readPushCampaignReport(client as never, CAMPAIGN),
    ).rejects.toThrowError(PushNotFoundError)
    expect(client.$queryRaw).not.toHaveBeenCalled()
  })

  it("answers zeros for a campaign that has dispatched nothing", async () => {
    const { client } = buildPrisma()
    const report = await readPushCampaignReport(client as never, CAMPAIGN)
    expect(report.campaignId).toBe(CAMPAIGN)
    expect(report.status).toBe("SENT")
    expect(report.sendingStartedAt).toEqual(SENDING_AT)
    expect(report.totals).toEqual(ZERO)
    expect(report.byLanguage).toEqual([])
    expect(report.byCountry).toEqual([])
  })

  it("carries every R25 count into the totals", async () => {
    const { client } = buildPrisma({
      deliveries: [
        deliveryRow({
          audience: 9n,
          accepted: 3n,
          handed_off: 2n,
          unknown_count: 1n,
          pending: 1n,
          failed: 1n,
          invalid: 1n,
          suppressed: 1n,
          unreachable: 1n,
          missed: 1n,
        }),
      ],
      opens: [openRow({ opened: 2n })],
      attributions: [attributionRow({ attributed: 1n, watch_starts: 3n })],
    })
    const report = await readPushCampaignReport(client as never, CAMPAIGN)
    expect(report.totals).toEqual({
      audience: 9,
      accepted: 3,
      handedOff: 2,
      unknown: 1,
      pending: 1,
      failed: 1,
      invalid: 1,
      suppressed: 1,
      unreachable: 1,
      missed: 1,
      opened: 2,
      attributed: 1,
      attributedWatchStarts: 3,
    })
  })

  it("splits by language and by country from the snapshot columns", async () => {
    const { client } = buildPrisma({
      deliveries: [
        deliveryRow({ audience: 3n, accepted: 3n }),
        deliveryRow({
          lang_total: 0,
          language_slug: "french",
          audience: 2n,
          accepted: 2n,
        }),
        deliveryRow({
          lang_total: 0,
          language_slug: "english",
          audience: 1n,
          accepted: 1n,
        }),
        deliveryRow({
          country_total: 0,
          country: "FR",
          audience: 2n,
          accepted: 2n,
        }),
        deliveryRow({
          country_total: 0,
          country: "NZ",
          audience: 1n,
          accepted: 1n,
        }),
      ],
      opens: [
        openRow({ opened: 1n }),
        openRow({ lang_total: 0, language_slug: "french", opened: 1n }),
        openRow({ country_total: 0, country: "FR", opened: 1n }),
      ],
      attributions: [],
    })
    const report = await readPushCampaignReport(client as never, CAMPAIGN)
    expect(report.byLanguage.map((slice) => slice.key)).toEqual([
      "english",
      "french",
    ])
    expect(report.byLanguage[1].counts).toEqual({
      ...ZERO,
      audience: 2,
      accepted: 2,
      opened: 1,
    })
    expect(report.byCountry.map((slice) => slice.key)).toEqual(["FR", "NZ"])
    expect(report.byCountry[0].counts.opened).toBe(1)
    // A slice with deliveries and no opens still reports its delivery counts.
    expect(report.byCountry[1].counts).toEqual({
      ...ZERO,
      audience: 1,
      accepted: 1,
    })
  })

  it("puts the phones with no country last, under one named key", async () => {
    const { client } = buildPrisma({
      deliveries: [
        deliveryRow({ audience: 2n }),
        deliveryRow({ country_total: 0, country: null, audience: 1n }),
        deliveryRow({ country_total: 0, country: "NZ", audience: 1n }),
      ],
    })
    const report = await readPushCampaignReport(client as never, CAMPAIGN)
    expect(report.byCountry.map((slice) => slice.key)).toEqual([
      "NZ",
      PUSH_REPORT_UNKNOWN_KEY,
    ])
  })

  it("keeps an unreachable phone out of every other count (AE17)", async () => {
    const { client } = buildPrisma({
      deliveries: [
        deliveryRow({ audience: 1n, unreachable: 1n }),
        deliveryRow({
          country_total: 0,
          country: "CN",
          audience: 1n,
          unreachable: 1n,
        }),
      ],
    })
    const report = await readPushCampaignReport(client as never, CAMPAIGN)
    // R26 makes an unreachable phone part of the audience, and of nothing else.
    expect(report.totals).toEqual({ ...ZERO, audience: 1, unreachable: 1 })
    expect(report.byCountry[0].counts).toEqual({
      ...ZERO,
      audience: 1,
      unreachable: 1,
    })
  })

  it("counts phones, not rows, and reads live deliveries only", async () => {
    const { client, queries } = buildPrisma()
    await readPushCampaignReport(client as never, CAMPAIGN)
    expect(queries).toHaveLength(3)
    for (const query of queries) {
      const text = sqlText(query)
      expect(text).toContain("COUNT(DISTINCT")
      expect(text).toContain("'live'")
      expect(text).toContain("GROUPING SETS")
    }
  })

  it("re-aggregates on every read, in every status", async () => {
    const { client } = buildPrisma()
    await readPushCampaignReport(client as never, CAMPAIGN)
    await readPushCampaignReport(client as never, CAMPAIGN)
    // No cache: opens and attributed watch starts keep arriving after the last
    // group, so a cached total would be wrong within the hour.
    expect(client.$queryRaw).toHaveBeenCalledTimes(6)
  })

  it("stamps each report with the instant it was aggregated", async () => {
    const { client } = buildPrisma()
    const report = await readPushCampaignReport(client as never, CAMPAIGN, {
      now: () => new Date("2026-10-03T04:00:00.000Z"),
    })
    expect(report.generatedAt.toISOString()).toBe("2026-10-03T04:00:00.000Z")
  })
})
