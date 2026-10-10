import { JWT } from "google-auth-library"
import { z } from "zod"
import { type Config, WatcherError } from "./config.js"
import { requestJson, type Fetch } from "./http.js"
import {
  MINUTE,
  SILENCE_MS,
  recordGaActivity,
  type State,
  type Observation,
} from "./state.js"

const RumSchema = z.object({
  data: z.array(
    z.object({
      attributes: z.object({
        timestamp: z.string().datetime({ offset: true }),
      }),
    }),
  ),
})
const GaSchema = z.object({
  dimensionHeaders: z.array(z.object({ name: z.string() })),
  metricHeaders: z.array(z.object({ name: z.string() })),
  rows: z
    .array(
      z.object({
        dimensionValues: z.array(z.object({ value: z.string() })),
        metricValues: z.array(z.object({ value: z.string().regex(/^\d+$/) })),
      }),
    )
    .optional(),
  rowCount: z.number().int().nonnegative().optional(),
  metadata: z
    .object({
      subjectToThresholding: z.boolean().optional(),
      dataLossFromOtherRow: z.boolean().optional(),
    })
    .optional(),
})

export function rumQuery(config: Pick<Config, "WATCH_URL">): string {
  const host = new URL(config.WATCH_URL).hostname
  return `service:forge-web env:prod @type:view @view.url_host:${host} @view.url_path:/watch/* -@session.type:synthetics`
}
export async function checkDatadog(
  config: Config,
  now: number,
  fetchImpl: Fetch = fetch,
): Promise<Observation> {
  try {
    const url = new URL(`https://api.${config.DD_SITE}/api/v2/rum/events`)
    url.search = new URLSearchParams({
      "filter[query]": rumQuery(config),
      "filter[from]": new Date(now - SILENCE_MS).toISOString(),
      "filter[to]": new Date(now).toISOString(),
      sort: "-timestamp",
      "page[limit]": "1",
    }).toString()
    const result = RumSchema.safeParse(
      await requestJson(
        url.href,
        {
          headers: {
            "DD-API-KEY": config.DD_API_KEY,
            "DD-APPLICATION-KEY": config.DD_APP_KEY,
          },
        },
        "Datadog",
        fetchImpl,
      ),
    )
    if (!result.success)
      throw new WatcherError("Datadog returned an unexpected response shape.")
    const latest = result.data.data[0]
    if (!latest)
      return {
        status: "bad",
        detail:
          "Datadog returned no production Watch RUM views in the preceding two hours.",
      }
    const timestamp = Date.parse(latest.attributes.timestamp)
    if (timestamp < now - SILENCE_MS || timestamp > now + MINUTE)
      throw new WatcherError(
        "Datadog returned an event outside the requested window.",
      )
    return {
      status: "good",
      detail: `Datadog received a production Watch RUM view at ${latest.attributes.timestamp}.`,
    }
  } catch (error) {
    return unknown(error, "Datadog")
  }
}

async function accessToken(config: Config): Promise<string> {
  try {
    const credentials = z
      .object({
        client_email: z.string().email(),
        private_key: z.string().min(1),
      })
      .parse(JSON.parse(config.GA4_CREDENTIALS_JSON))
    const client = new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    })
    const token = await client.getAccessToken()
    if (!token.token) throw new WatcherError("GA token unavailable.")
    return token.token
  } catch {
    throw new WatcherError("GA read-only authentication failed.")
  }
}

export function latestGaActivity(
  raw: unknown,
  stream: string,
  now: number,
): number | null {
  const parsed = GaSchema.safeParse(raw)
  if (!parsed.success)
    throw new WatcherError("GA returned an unexpected response shape.")
  const report = parsed.data
  if (
    report.dimensionHeaders.map((h) => h.name).join() !==
      "minutesAgo,streamId" ||
    report.metricHeaders.map((h) => h.name).join() !== "eventCount" ||
    report.metadata?.subjectToThresholding ||
    report.metadata?.dataLossFromOtherRow ||
    (report.rowCount ?? 0) > (report.rows?.length ?? 0)
  ) {
    throw new WatcherError(
      "GA response is incomplete or uses unexpected columns.",
    )
  }
  let latest: number | null = null
  for (const row of report.rows ?? []) {
    const [minute, streamId] = row.dimensionValues.map((d) => d.value)
    const count = Number(row.metricValues[0]?.value)
    if (
      row.dimensionValues.length !== 2 ||
      row.metricValues.length !== 1 ||
      streamId !== stream ||
      !/^\d{1,2}$/.test(minute) ||
      Number(minute) > 29 ||
      !Number.isSafeInteger(count)
    ) {
      throw new WatcherError("GA response contains invalid activity values.")
    }
    // End of the bucket, conservatively: never declare silence one minute early.
    if (count > 0)
      latest = Math.max(
        latest ?? 0,
        now - Math.max(0, Number(minute) - 1) * MINUTE,
      )
  }
  return latest
}

export async function checkGa(
  config: Config,
  state: State,
  now: number,
  fetchImpl: Fetch = fetch,
  tokenProvider = accessToken,
): Promise<Observation> {
  try {
    const token = await tokenProvider(config)
    const raw = await requestJson(
      `https://analyticsdata.googleapis.com/v1beta/properties/${config.GA4_PROPERTY_ID}:runRealtimeReport`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dimensions: [{ name: "minutesAgo" }, { name: "streamId" }],
          metrics: [{ name: "eventCount" }],
          dimensionFilter: {
            andGroup: {
              expressions: [
                {
                  filter: {
                    fieldName: "streamId",
                    stringFilter: {
                      matchType: "EXACT",
                      value: config.GA4_STREAM_ID,
                    },
                  },
                },
                {
                  filter: {
                    fieldName: "eventName",
                    stringFilter: { matchType: "EXACT", value: "page_view" },
                  },
                },
              ],
            },
          },
          limit: 100,
        }),
      },
      "GA",
      fetchImpl,
    )
    return recordGaActivity(
      state,
      latestGaActivity(raw, config.GA4_STREAM_ID, now),
      now,
    )
  } catch (error) {
    delete state.ga
    return unknown(error, "GA")
  }
}
function unknown(error: unknown, provider: string): Observation {
  return {
    status: "unknown",
    detail:
      error instanceof WatcherError
        ? error.message
        : `${provider} monitoring failed.`,
  }
}
