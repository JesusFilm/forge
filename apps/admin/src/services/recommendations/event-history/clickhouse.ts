import {
  MAX_EVENT_ENVELOPE_BYTES,
  parseRecommendationEventEnvelope,
  RECOMMENDATION_EVENT_FAMILIES,
  type RecommendationEventEnvelope,
  type RecommendationEventFamily,
} from "./envelope"
import {
  WATCH_EXPOSURE_BREAKDOWN_SQL,
  WATCH_EXPOSURE_CONFLICT_SQL,
} from "./watch-exposure-query"

const MAX_BATCH_EVENTS = 100
const MAX_BATCH_BYTES = 1_048_576
const MAX_RESPONSE_BYTES = 33_554_432
const MAX_IDS = 100
const MAX_ID_BYTES = 19_100
const WATCH_REPORT_SETTINGS = {
  max_execution_time: "3",
  timeout_before_checking_execution_speed: "0",
  max_rows_to_read: "20000000",
  read_overflow_mode: "throw",
  max_result_rows: "129",
  result_overflow_mode: "throw",
  max_memory_usage: "1073741824",
  max_threads: "2",
  optimize_aggregation_in_order: "1",
}

export class RecommendationClickHouseError extends Error {
  constructor(
    readonly code:
      | "configuration"
      | "invalid_input"
      | "timeout"
      | "transport"
      | "response"
      | "conflict",
  ) {
    super(`Recommendation ClickHouse ${code}`)
    this.name = "RecommendationClickHouseError"
  }
}

export type RecommendationClickHouseClient = {
  insert(events: readonly RecommendationEventEnvelope[]): Promise<void>
  read(input: {
    family: RecommendationEventFamily
    logicalIds: readonly string[]
    asOf: Date
    now?: Date
  }): Promise<RecommendationEventEnvelope[]>
  erase(input: {
    family: RecommendationEventFamily
    logicalIds: readonly string[]
  }): Promise<void>
  watchExposureBreakdown(
    input: WatchExposureBreakdownInput,
  ): Promise<WatchExposureAggregate>
}

export type WatchExposureBreakdownInput = {
  start: Date
  end: Date
  now: Date
  asOf?: Date
  filter?: {
    surface: string
    block: string
    presentation: string
    placement?: string
    policyVersion?: string
  }
}

export type WatchExposureAggregateRow = {
  surface: string
  block: string
  presentation: string
  placement: string
  policyVersion: string
  position: number
  served: number
  rendered: number
  eligible: number
  selected: number
  eligibleSelected: number
  repeats: number
  acceptedAttempts: number
  duplicates: number
  occlusionAware: number
  visibilityUnknown: number
}

export type WatchExposureAggregate = {
  rows: WatchExposureAggregateRow[]
  truncated: boolean
}

type Config = {
  endpoint: string
  database: string
  username: string
  password: string
  timeoutMs?: number
  fetch?: (input: URL, init: RequestInit) => Promise<Response>
  allowLoopbackHttpForTest?: boolean
}

const INSERT_SQL = `INSERT INTO recommendation_event_history
(family, logical_id, revision, occurred_at, accepted_at, expires_at, payload_digest, payload)
FORMAT JSONEachRow\n`

const READ_SQL = `SELECT logical_id, max(revision) AS latest_revision,
  toUInt32(sum(variants > 1)) AS conflicts,
  argMax(canonical_occurred_at, revision) AS occurred_at,
  argMax(canonical_accepted_at, revision) AS accepted_at,
  argMax(canonical_expires_at, revision) AS expires_at,
  argMax(canonical_payload_digest, revision) AS payload_digest,
  argMax(canonical_payload, revision) AS payload
FROM (
  SELECT logical_id, revision,
    uniqExact(tuple(occurred_at, accepted_at, expires_at, payload_digest, payload)) AS variants,
    any(occurred_at) AS canonical_occurred_at, any(accepted_at) AS canonical_accepted_at,
    any(expires_at) AS canonical_expires_at, any(payload_digest) AS canonical_payload_digest,
    any(payload) AS canonical_payload
  FROM recommendation_event_history
  WHERE family = {family:String} AND logical_id IN (__IDS__)
    AND accepted_at <= {as_of:String}
    AND logical_id NOT IN (
      SELECT logical_id FROM recommendation_event_erasure
      WHERE family = {family:String} AND logical_id IN (__IDS__)
    )
  GROUP BY logical_id, revision
)
GROUP BY logical_id
ORDER BY logical_id
FORMAT JSONEachRow`

const ERASURE_SQL = `INSERT INTO recommendation_event_erasure (family, logical_id) FORMAT JSONEachRow\n`
const DELETE_SQL = `DELETE FROM recommendation_event_history
WHERE family = {family:String} AND logical_id IN (__IDS__)`
const CONFLICT_SQL = `SELECT toUInt32(sum(variants > 1)) AS conflicts FROM (
  SELECT logical_id, revision,
    uniqExact(tuple(occurred_at, accepted_at, expires_at, payload_digest, payload)) AS variants
  FROM recommendation_event_history
  WHERE family = {family:String} AND logical_id IN (__IDS__)
  GROUP BY logical_id, revision
) FORMAT JSONEachRow`

function withIds(
  sql: string,
  family: RecommendationEventFamily,
  ids: readonly string[],
) {
  const placeholders = ids.map((_, index) => `{id${index}:String}`).join(", ")
  return {
    sql: sql.replaceAll("__IDS__", placeholders),
    params: Object.fromEntries([
      ["family", family],
      ...ids.map((id, index) => [`id${index}`, id]),
    ]),
  }
}

function validIds(
  family: RecommendationEventFamily,
  ids: readonly string[],
): void {
  if (
    !RECOMMENDATION_EVENT_FAMILIES.includes(family) ||
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > MAX_IDS ||
    new Set(ids).size !== ids.length ||
    ids.some(
      (id) =>
        typeof id !== "string" ||
        id.length > 191 ||
        !/^[A-Za-z0-9][A-Za-z0-9:_./-]*$/.test(id),
    ) ||
    Buffer.byteLength(JSON.stringify(ids)) > MAX_ID_BYTES
  )
    throw new RecommendationClickHouseError("invalid_input")
}

function validEndpoint(config: Config): URL {
  let url: URL
  try {
    url = new URL(config.endpoint)
  } catch {
    throw new RecommendationClickHouseError("configuration")
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  if (
    (url.protocol !== "https:" &&
      !(
        config.allowLoopbackHttpForTest &&
        loopback &&
        url.protocol === "http:"
      )) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(config.database) ||
    typeof config.username !== "string" ||
    !config.username ||
    /[\r\n]/.test(config.username) ||
    typeof config.password !== "string" ||
    !config.password ||
    /[\r\n]/.test(config.password) ||
    (config.timeoutMs !== undefined &&
      (!Number.isSafeInteger(config.timeoutMs) ||
        config.timeoutMs < 100 ||
        config.timeoutMs > 30_000))
  )
    throw new RecommendationClickHouseError("configuration")
  return url
}

function responseText(
  response: Response,
  signal: AbortSignal,
): Promise<string> {
  return (async () => {
    if (!response.body) return ""
    const reader = response.body.getReader()
    const onAbort = () => {
      void reader.cancel().catch(() => {})
    }
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) onAbort()
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      while (true) {
        if (signal.aborted) throw new RecommendationClickHouseError("timeout")
        const next = await reader.read()
        if (next.done) break
        bytes += next.value.byteLength
        if (bytes > MAX_RESPONSE_BYTES)
          throw new RecommendationClickHouseError("response")
        chunks.push(next.value)
      }
    } finally {
      signal.removeEventListener("abort", onAbort)
      reader.releaseLock()
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    )
  })()
}

export function createRecommendationClickHouseClient(
  config: Config,
): RecommendationClickHouseClient {
  const base = validEndpoint(config)
  const transport = config.fetch ?? fetch
  const timeoutMs = config.timeoutMs ?? 10_000

  async function withDeadline<T>(
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController()
    const timeout = () => new RecommendationClickHouseError("timeout")
    let onAbort: () => void = () => {}
    const expired = new Promise<never>((_, reject) => {
      onAbort = () => reject(timeout())
      controller.signal.addEventListener("abort", onAbort, { once: true })
    })
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await Promise.race([work(controller.signal), expired])
    } catch (error) {
      if (controller.signal.aborted) throw timeout()
      throw error
    } finally {
      clearTimeout(timer)
      controller.abort()
      controller.signal.removeEventListener("abort", onAbort)
    }
  }

  async function execute(
    signal: AbortSignal,
    sql: string,
    params: Record<string, string> = {},
    settings: Record<string, string> = {},
  ): Promise<string> {
    const url = new URL(base)
    url.searchParams.set("database", config.database)
    url.searchParams.set("wait_end_of_query", "1")
    url.searchParams.set("buffer_size", String(MAX_RESPONSE_BYTES))
    url.searchParams.set("max_result_bytes", String(MAX_RESPONSE_BYTES))
    url.searchParams.set("async_insert", "0")
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(`param_${key}`, value)
    for (const [key, value] of Object.entries(settings))
      url.searchParams.set(key, value)
    if (signal.aborted) throw new RecommendationClickHouseError("timeout")
    try {
      const response = await transport(url, {
        method: "POST",
        redirect: "error",
        headers: {
          "X-ClickHouse-User": config.username,
          "X-ClickHouse-Key": config.password,
          "Content-Type": "text/plain; charset=utf-8",
        },
        body: sql,
        signal,
      })
      const body = await responseText(response, signal)
      if (signal.aborted) throw new RecommendationClickHouseError("timeout")
      if (
        response.status !== 200 ||
        response.headers.has("X-ClickHouse-Exception-Code")
      )
        throw new RecommendationClickHouseError("transport")
      return body
    } catch (error) {
      if (signal.aborted) throw new RecommendationClickHouseError("timeout")
      if (error instanceof RecommendationClickHouseError) throw error
      throw new RecommendationClickHouseError("transport")
    }
  }

  async function erased(
    signal: AbortSignal,
    family: RecommendationEventFamily,
    ids: readonly string[],
  ): Promise<boolean> {
    const query = withIds(
      `SELECT uniqExact(logical_id) AS count FROM recommendation_event_erasure WHERE family = {family:String} AND logical_id IN (__IDS__) FORMAT JSONEachRow`,
      family,
      ids,
    )
    const rows = await execute(signal, query.sql, query.params)
    try {
      const parsed: unknown = JSON.parse(rows.trim())
      if (typeof parsed !== "object" || parsed === null || !("count" in parsed))
        throw new Error()
      const count = (parsed as { count: unknown }).count
      if (typeof count !== "string" && typeof count !== "number")
        throw new Error()
      const n = Number(count)
      if (!Number.isSafeInteger(n) || n < 0 || n > ids.length) throw new Error()
      return n > 0
    } catch {
      throw new RecommendationClickHouseError("response")
    }
  }

  async function assertNoConflicts(
    signal: AbortSignal,
    family: RecommendationEventFamily,
    ids: readonly string[],
  ): Promise<void> {
    const query = withIds(CONFLICT_SQL, family, ids)
    const result = await execute(signal, query.sql, query.params)
    try {
      const row: unknown = JSON.parse(result.trim())
      if (
        !row ||
        typeof row !== "object" ||
        !("conflicts" in row) ||
        typeof row.conflicts !== "number" ||
        !Number.isSafeInteger(row.conflicts) ||
        row.conflicts < 0
      )
        throw new Error()
      if (row.conflicts > 0) throw new RecommendationClickHouseError("conflict")
    } catch (error) {
      if (error instanceof RecommendationClickHouseError) throw error
      throw new RecommendationClickHouseError("response")
    }
  }

  return {
    async insert(events) {
      return withDeadline(async (signal) => {
        if (
          !Array.isArray(events) ||
          events.length < 1 ||
          events.length > MAX_BATCH_EVENTS
        )
          throw new RecommendationClickHouseError("invalid_input")
        const rows: string[] = []
        let bytes = Buffer.byteLength(INSERT_SQL)
        const identities = new Map<string, string>()
        for (const event of events) {
          let valid: RecommendationEventEnvelope
          try {
            valid = parseRecommendationEventEnvelope(JSON.stringify(event))
          } catch {
            throw new RecommendationClickHouseError("invalid_input")
          }
          if (
            Buffer.byteLength(JSON.stringify(valid)) > MAX_EVENT_ENVELOPE_BYTES
          )
            throw new RecommendationClickHouseError("invalid_input")
          const identity = `${valid.family}\0${valid.logicalId}\0${valid.revision}`
          const fingerprint = `${valid.occurredAt}\0${valid.acceptedAt}\0${valid.expiresAt}\0${valid.payloadDigest}`
          if (
            identities.has(identity) &&
            identities.get(identity) !== fingerprint
          )
            throw new RecommendationClickHouseError("conflict")
          identities.set(identity, fingerprint)
          const row =
            JSON.stringify({
              family: valid.family,
              logical_id: valid.logicalId,
              revision: valid.revision,
              occurred_at: valid.occurredAt,
              accepted_at: valid.acceptedAt,
              expires_at: valid.expiresAt,
              payload_digest: valid.payloadDigest,
              payload: JSON.stringify(valid.payload),
            }) + "\n"
          bytes += Buffer.byteLength(row)
          if (bytes > MAX_BATCH_BYTES)
            throw new RecommendationClickHouseError("invalid_input")
          rows.push(row)
        }
        // A suppression marker is terminal for this logical ID. The relay must also
        // fence its in-flight generations; feat-895 reconciles late physical writes.
        const groups = new Map<RecommendationEventFamily, string[]>()
        for (const event of events)
          groups.set(event.family, [
            ...(groups.get(event.family) ?? []),
            event.logicalId,
          ])
        for (const [family, ids] of groups)
          if (await erased(signal, family, [...new Set(ids)]))
            throw new RecommendationClickHouseError("conflict")
        for (const [family, ids] of groups)
          await assertNoConflicts(signal, family, [...new Set(ids)])
        const result = await execute(signal, INSERT_SQL + rows.join(""))
        if (result !== "") throw new RecommendationClickHouseError("response")
        for (const [family, ids] of groups)
          await assertNoConflicts(signal, family, [...new Set(ids)])
        for (const [family, ids] of groups)
          if (await erased(signal, family, [...new Set(ids)]))
            throw new RecommendationClickHouseError("conflict")
      })
    },
    async read({ family, logicalIds, asOf, now = new Date() }) {
      return withDeadline(async (signal) => {
        validIds(family, logicalIds)
        if (
          !(asOf instanceof Date) ||
          Number.isNaN(asOf.getTime()) ||
          !(now instanceof Date) ||
          Number.isNaN(now.getTime())
        )
          throw new RecommendationClickHouseError("invalid_input")
        const expiryCutoff = new Date(
          Math.max(asOf.getTime(), now.getTime()),
        ).toISOString()
        const query = withIds(READ_SQL, family, logicalIds)
        const result = await execute(signal, query.sql, {
          ...query.params,
          as_of: asOf.toISOString(),
        })
        const events: RecommendationEventEnvelope[] = []
        if (result === "") return events
        for (const line of result.trimEnd().split("\n")) {
          let row: Record<string, unknown>
          try {
            row = JSON.parse(line)
          } catch {
            throw new RecommendationClickHouseError("response")
          }
          if (
            !row ||
            typeof row !== "object" ||
            Array.isArray(row) ||
            Object.keys(row).sort().join(",") !==
              "accepted_at,conflicts,expires_at,latest_revision,logical_id,occurred_at,payload,payload_digest" ||
            typeof row.logical_id !== "string" ||
            !logicalIds.includes(row.logical_id) ||
            !Number.isSafeInteger(row.latest_revision) ||
            typeof row.conflicts !== "number" ||
            !Number.isSafeInteger(row.conflicts) ||
            row.conflicts < 0 ||
            typeof row.payload !== "string" ||
            typeof row.payload_digest !== "string"
          )
            throw new RecommendationClickHouseError("response")
          if (row.conflicts > 0)
            throw new RecommendationClickHouseError("conflict")
          let envelope: RecommendationEventEnvelope
          try {
            envelope = parseRecommendationEventEnvelope(
              JSON.stringify({
                version: 1,
                family,
                logicalId: row.logical_id,
                revision: row.latest_revision,
                occurredAt: row.occurred_at,
                acceptedAt: row.accepted_at,
                expiresAt: row.expires_at,
                payloadDigest: row.payload_digest,
                payload: JSON.parse(row.payload),
              }),
            )
          } catch {
            throw new RecommendationClickHouseError("response")
          }
          if (envelope.expiresAt > expiryCutoff) events.push(envelope)
        }
        if (
          events.length > logicalIds.length ||
          new Set(events.map((event) => event.logicalId)).size !== events.length
        )
          throw new RecommendationClickHouseError("response")
        return events
      })
    },
    async watchExposureBreakdown({ start, end, now, asOf = end, filter }) {
      return withDeadline(async (signal) => {
        if (
          !(start instanceof Date) ||
          Number.isNaN(start.getTime()) ||
          !(end instanceof Date) ||
          Number.isNaN(end.getTime()) ||
          !(now instanceof Date) ||
          Number.isNaN(now.getTime()) ||
          !(asOf instanceof Date) ||
          Number.isNaN(asOf.getTime()) ||
          start >= end ||
          end > asOf ||
          asOf > now ||
          end.getTime() - start.getTime() > 14 * 86_400_000 ||
          (filter !== undefined &&
            ([
              filter.surface,
              filter.block,
              filter.presentation,
              filter.placement,
              filter.policyVersion,
            ].some(
              (value) =>
                value !== undefined &&
                (typeof value !== "string" || Buffer.byteLength(value) > 128),
            ) ||
              !filter.surface ||
              !filter.block ||
              !filter.presentation))
        )
          throw new RecommendationClickHouseError("invalid_input")
        const params = {
          start: start.toISOString(),
          end: end.toISOString(),
          now: now.toISOString(),
          as_of: asOf.toISOString(),
          filter: filter ? "1" : "0",
          surface: filter?.surface ?? "",
          block: filter?.block ?? "",
          presentation: filter?.presentation ?? "",
          has_placement: filter?.placement === undefined ? "0" : "1",
          placement: filter?.placement ?? "",
          has_policy: filter?.policyVersion === undefined ? "0" : "1",
          policy: filter?.policyVersion ?? "",
        }
        const result = await execute(
          signal,
          WATCH_EXPOSURE_BREAKDOWN_SQL,
          params,
          WATCH_REPORT_SETTINGS,
        )
        const audit = await execute(
          signal,
          WATCH_EXPOSURE_CONFLICT_SQL,
          params,
          WATCH_REPORT_SETTINGS,
        )
        try {
          const parsed: unknown = JSON.parse(audit.trim())
          if (
            !parsed ||
            typeof parsed !== "object" ||
            !("conflicts" in parsed) ||
            Object.keys(parsed).length !== 1 ||
            typeof parsed.conflicts !== "number" ||
            !Number.isSafeInteger(parsed.conflicts) ||
            parsed.conflicts < 0
          )
            throw new Error()
          if (parsed.conflicts > 0)
            throw new RecommendationClickHouseError("conflict")
        } catch (error) {
          if (error instanceof RecommendationClickHouseError) throw error
          throw new RecommendationClickHouseError("response")
        }
        const rows: WatchExposureAggregateRow[] = []
        if (result === "") return { rows, truncated: false }
        const lines = result.trimEnd().split("\n")
        if (lines.length > 129)
          throw new RecommendationClickHouseError("response")
        for (const line of lines) {
          let row: Record<string, unknown>
          try {
            row = JSON.parse(line)
          } catch {
            throw new RecommendationClickHouseError("response")
          }
          const keys = [
            "surface",
            "block",
            "presentation",
            "placement",
            "policy_version",
            "position",
            "served",
            "rendered",
            "eligible",
            "selected",
            "eligible_selected",
            "repeats",
            "accepted_attempts",
            "duplicates",
            "occlusion_aware",
            "visibility_unknown",
          ]
          if (
            !row ||
            typeof row !== "object" ||
            Array.isArray(row) ||
            Object.keys(row).sort().join(",") !== keys.sort().join(",")
          )
            throw new RecommendationClickHouseError("response")
          const string = (key: string) => {
            if (typeof row[key] !== "string" || !row[key])
              throw new RecommendationClickHouseError("response")
            return row[key] as string
          }
          const number = (key: string) => {
            const value = row[key]
            const parsed =
              typeof value === "number"
                ? value
                : typeof value === "string" && /^\d+$/.test(value)
                  ? Number(value)
                  : NaN
            if (!Number.isSafeInteger(parsed) || parsed < 0)
              throw new RecommendationClickHouseError("response")
            return parsed
          }
          rows.push({
            surface: string("surface"),
            block: string("block"),
            presentation: string("presentation"),
            placement: string("placement"),
            policyVersion: string("policy_version"),
            position: number("position"),
            served: number("served"),
            rendered: number("rendered"),
            eligible: number("eligible"),
            selected: number("selected"),
            eligibleSelected: number("eligible_selected"),
            repeats: number("repeats"),
            acceptedAttempts: number("accepted_attempts"),
            duplicates: number("duplicates"),
            occlusionAware: number("occlusion_aware"),
            visibilityUnknown: number("visibility_unknown"),
          })
        }
        return { rows: rows.slice(0, 128), truncated: rows.length > 128 }
      })
    },
    async erase({ family, logicalIds }) {
      return withDeadline(async (signal) => {
        validIds(family, logicalIds)
        const rows =
          logicalIds
            .map((id) => JSON.stringify({ family, logical_id: id }))
            .join("\n") + "\n"
        const marker = await execute(signal, ERASURE_SQL + rows)
        if (marker !== "") throw new RecommendationClickHouseError("response")
        const query = withIds(DELETE_SQL, family, logicalIds)
        const result = await execute(signal, query.sql, query.params, {
          lightweight_deletes_sync: "2",
        })
        if (result !== "") throw new RecommendationClickHouseError("response")
      })
    },
  }
}
