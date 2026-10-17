/**
 * The synthetic load proof the plan asks for before the first real campaign.
 *
 * It runs the real batch step over 100,000 synthetic registrations in 40 zone
 * groups against a stub transport that enforces the provider's own limits: 100
 * messages per request, the process-wide message bucket, and the configured
 * concurrency. Nothing touches Postgres and nothing reaches Expo.
 *
 * Run with:
 *   CI=1 pnpm --filter @forge/admin exec tsx src/scripts/push-campaign-dry-run.ts
 *
 * CI=1 skips env validation: the dry run reaches no database and no provider,
 * so it needs none of the deployed variables.
 *
 * Options:
 *   --registrations=<n>  default 100000
 *   --groups=<n>         default 40
 *   --messages-per-second=<n>  default 500, the project ceiling
 *   --unpaced            skips the message bucket for a fast smoke; the
 *                        sizing proof needs the pacing, so leave it off
 */
import { performance } from "node:perf_hooks"

import {
  runPushCampaignBatch,
  type PushBatchStore,
} from "@/services/push/batch"
import {
  PUSH_PROVIDER_CHUNK_SIZE,
  resetPushSendRateBucket,
  reservePushSendWindow,
  resolvePushSendConfig,
  type PushSendConfig,
  type PushSendOutcome,
  type PushTransport,
} from "@/services/push/transport"

const DEFAULT_REGISTRATIONS = 100_000
const DEFAULT_GROUPS = 40
const ZONE_PREFIX = "Etc/GMT"

type StubViolation = Readonly<{ kind: string; detail: string }>

type DryRunReport = Readonly<{
  registrations: number
  groups: number
  pages: number
  chunks: number
  accepted: number
  slowestStepMs: number
  slowestStepGroup: number
  totalMs: number
  observedMessagesPerSecond: number
  violations: StubViolation[]
}>

function numberOption(name: string, fallback: number): number {
  const raw = process.argv
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.split("=")[1]
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * A transport that answers like Expo and refuses what Expo refuses. Its whole
 * job is to fail the dry run if the send path ever breaks a provider limit.
 */
function stubTransport(input: {
  config: PushSendConfig
  violations: StubViolation[]
  counters: { chunks: number; messages: number; inFlight: number }
  paced: boolean
}): PushTransport {
  const { config, violations, counters } = input
  let windowStartedAt = performance.now()
  let windowMessages = 0
  return {
    async sendChunk(messages) {
      if (messages.length > PUSH_PROVIDER_CHUNK_SIZE) {
        violations.push({
          kind: "chunk_too_large",
          detail: `${messages.length} messages in one request`,
        })
      }
      counters.inFlight += 1
      if (counters.inFlight > config.providerConcurrency) {
        violations.push({
          kind: "concurrency_exceeded",
          detail: `${counters.inFlight} requests in flight`,
        })
      }
      counters.chunks += 1
      counters.messages += messages.length

      // The real transport paces inside sendChunk, so the stub takes the same
      // window. Without it the dry run measures nothing but loop overhead.
      if (input.paced) {
        const wait = reservePushSendWindow(
          messages.length,
          config.messagesPerSecond,
        )
        if (wait > 0) {
          await new Promise((resolve) => setTimeout(resolve, wait))
        }
      }

      // Close the window before this chunk joins it, or the chunk that lands
      // exactly on the boundary is counted in the window it did not belong to.
      const at = performance.now()
      const elapsed = at - windowStartedAt
      if (elapsed >= 1_000) {
        const rate = (windowMessages / elapsed) * 1_000
        // A ten percent margin absorbs the timer's own jitter; a real overrun
        // is many times the ceiling, not a few percent.
        if (rate > config.messagesPerSecond * 1.1) {
          violations.push({
            kind: "rate_limit_exceeded",
            detail: `${Math.round(rate)} messages per second`,
          })
        }
        windowStartedAt = at
        windowMessages = 0
      }
      windowMessages += messages.length

      const outcomes: PushSendOutcome[] = messages.map((_message, index) => ({
        kind: "accepted",
        ticketId: `dry-run-ticket-${counters.chunks}-${index}`,
      }))
      counters.inFlight -= 1
      return outcomes
    },
    async fetchReceipts() {
      return new Map()
    },
  }
}

/** An in-memory store with the synthetic audience. No Postgres is involved. */
function syntheticStore(input: {
  registrations: number
  groups: number
}): PushBatchStore & { pagesRead: number } {
  const perGroup = Math.ceil(input.registrations / input.groups)
  const state = { pagesRead: 0 }
  const campaign = {
    id: "dry-run-campaign",
    status: "SENDING" as const,
    mode: "WAVE" as const,
    sendDate: new Date("2026-10-02T00:00:00.000Z"),
    localHour: 9,
    destinationKind: "SERIES" as const,
    destinationSlug: "washi-gospel",
    audienceScope: "EVERYWHERE" as const,
    countries: [] as string[],
    languageFilter: [] as string[],
  }
  const store: PushBatchStore & { pagesRead: number } = {
    get pagesRead() {
      return state.pagesRead
    },
    async readCampaign() {
      return campaign
    },
    async readCopy() {
      return [
        { languageSlug: "english", title: "Good news", body: "Watch today" },
      ]
    },
    async readLanguages() {
      return [{ slug: "english", bcp47: "en" }]
    },
    async readZonesAt({ instant }) {
      return [`${ZONE_PREFIX}${instant.getUTCHours()}`]
    },
    async readAudiencePage({ timeZones, cursor, limit }) {
      state.pagesRead += 1
      const zone = timeZones?.[0] ?? `${ZONE_PREFIX}0`
      const offset = cursor ? Number.parseInt(cursor.split(":")[1], 10) + 1 : 0
      const remaining = Math.max(0, perGroup - offset)
      const size = Math.min(limit, remaining)
      const audience = Array.from({ length: size }, (_value, index) => ({
        id: `${zone}:${offset + index}`,
        expoPushToken: `ExponentPushToken[dry-${zone}-${offset + index}]`,
        platform: "IOS" as const,
        appLanguageSlug: "english",
        phoneLanguageSlug: "english",
        phoneLocale: "en-NZ",
        timeZone: zone,
        country: "NZ",
      }))
      return {
        audience,
        unreachable: [],
        nextCursor:
          offset + size < perGroup ? `${zone}:${offset + size - 1}` : null,
      }
    },
    async readTestDevices() {
      return []
    },
    async claimPage({ candidates }) {
      return {
        claimed: candidates.map((candidate, index) => ({
          id: `${candidate.registrationId}:delivery:${index}`,
          nonce: candidate.registrationId.padEnd(43, "x").slice(0, 43),
          registrationId: candidate.registrationId,
          languageSlug: candidate.languageSlug,
          country: candidate.country,
          timeZone: candidate.timeZone,
          localDay: candidate.localDay,
        })),
        suppressed: [],
        alreadyClaimed: [],
      }
    },
    async readReserved() {
      return []
    },
    async markUnreachable() {
      return 0
    },
    async moveReservedToSending({ deliveryIds }) {
      return deliveryIds.map((id) => ({
        id,
        nonce: id.padEnd(43, "x").slice(0, 43),
        registrationId: id.split(":delivery:")[0],
        languageSlug: "english",
        country: "NZ",
        timeZone: id.split(":")[0],
      }))
    },
    async revertSendingToReserved() {
      return 0
    },
    async markReservedAsMissed() {
      return 0
    },
    async startSending() {
      return true
    },
    async markZones() {
      return 1
    },
    async recordAccepted() {},
    async recordFailed() {},
    async recordDeadTokens() {},
  }
  return store
}

export async function runPushCampaignDryRun(options?: {
  registrations?: number
  groups?: number
  messagesPerSecond?: number
  /** Off only for a fast smoke; the sizing proof needs the real pacing. */
  paced?: boolean
}): Promise<DryRunReport> {
  const registrations = options?.registrations ?? DEFAULT_REGISTRATIONS
  const groups = options?.groups ?? DEFAULT_GROUPS
  const base = resolvePushSendConfig()
  const config: PushSendConfig = {
    ...base,
    campaignsEnabled: true,
    messagesPerSecond: options?.messagesPerSecond ?? base.messagesPerSecond,
  }
  const violations: StubViolation[] = []
  const counters = { chunks: 0, messages: 0, inFlight: 0 }
  const store = syntheticStore({ registrations, groups })
  const paced = options?.paced ?? true
  const transport = stubTransport({ config, violations, counters, paced })

  resetPushSendRateBucket()
  let slowestStepMs = 0
  let slowestStepGroup = 0
  let accepted = 0
  const startedAt = performance.now()

  for (let group = 0; group < groups; group += 1) {
    const instant = new Date(Date.UTC(2026, 9, 2, group % 24))
    let cursor: string | null = null
    do {
      const stepStartedAt = performance.now()
      const result = await runPushCampaignBatch(
        {
          campaignId: "dry-run-campaign",
          kind: "LIVE",
          groupInstant: instant.toISOString(),
          cursor,
        },
        { store, transport, config, now: () => new Date() },
      )
      const stepMs = performance.now() - stepStartedAt
      if (stepMs > slowestStepMs) {
        slowestStepMs = stepMs
        slowestStepGroup = group
      }
      if (stepMs > config.stepMaxDurationMs) {
        violations.push({
          kind: "step_over_budget",
          detail: `group ${group} step ran ${Math.round(stepMs)}ms`,
        })
      }
      accepted += result.counts.accepted
      cursor = result.nextCursor
    } while (cursor != null)
  }

  const totalMs = performance.now() - startedAt
  const expectedMs = (registrations / config.messagesPerSecond) * 1_000
  if (paced && Math.abs(totalMs - expectedMs) > expectedMs * 0.1) {
    violations.push({
      kind: "wave_time_off_sizing_table",
      detail: `${Math.round(totalMs)}ms against an expected ${Math.round(expectedMs)}ms`,
    })
  }
  return {
    registrations,
    groups,
    pages: store.pagesRead,
    chunks: counters.chunks,
    accepted,
    slowestStepMs: Math.round(slowestStepMs),
    slowestStepGroup,
    totalMs: Math.round(totalMs),
    observedMessagesPerSecond: Math.round(
      (counters.messages / totalMs) * 1_000,
    ),
    violations,
  }
}

async function main(): Promise<void> {
  const report = await runPushCampaignDryRun({
    registrations: numberOption("registrations", DEFAULT_REGISTRATIONS),
    groups: numberOption("groups", DEFAULT_GROUPS),
    messagesPerSecond: numberOption("messages-per-second", 500),
    paced: !process.argv.includes("--unpaced"),
  })

  console.log(
    `[push] event=dry_run_complete registrations=${report.registrations} groups=${report.groups} pages=${report.pages} chunks=${report.chunks} accepted=${report.accepted} slowest_step_ms=${report.slowestStepMs} slowest_step_group=${report.slowestStepGroup} total_ms=${report.totalMs} messages_per_second=${report.observedMessagesPerSecond} violations=${report.violations.length}`,
  )
  for (const violation of report.violations) {
    console.error(
      `[push] event=dry_run_violation kind=${violation.kind} detail=${violation.detail}`,
    )
  }
  if (report.violations.length > 0) process.exitCode = 1
}

// Guarded so the module can be imported by a test without running the load.
// tsx compiles this file to CommonJS, which has no top-level await.
if (process.argv[1]?.endsWith("push-campaign-dry-run.ts")) {
  void main()
}
