/**
 * KTD1 and KTD15 — the push provider, wrapped.
 *
 * Three rules hold this file together. The provider's message string embeds the
 * push token, so only its error code ever leaves here. Every request runs under
 * an explicit deadline, and a failure the codes cannot classify is called
 * indeterminate, never retryable: loss is accepted and duplication is not. The
 * message bucket is process-wide, so two transports in one worker still share
 * one rate ceiling.
 */
import Expo, {
  type ExpoPushMessage,
  type ExpoPushReceipt,
  type ExpoPushTicket,
} from "expo-server-sdk"

import { env, resolvePushFcmBlockedCountries } from "@/config/env"

import {
  PushProviderAuthError,
  PushProviderFatalError,
  PushProviderIndeterminateError,
  PushProviderRetryableError,
  PushTransportConfigurationError,
} from "./errors"

// Re-exported so a caller needs one import for the provider and its failures.
export {
  PushProviderAuthError,
  PushProviderFatalError,
  PushProviderIndeterminateError,
  PushProviderRetryableError,
  PushTransportConfigurationError,
} from "./errors"

/** The app's Android channel for announcements (KTD9). */
export const PUSH_ANDROID_CHANNEL_ID = "announcements"
/** The provider sends at most 100 notifications per request. */
export const PUSH_PROVIDER_CHUNK_SIZE = 100
/** KTD15 — the caller's receipt chunk. Each request is split again below. */
export const PUSH_RECEIPT_CHUNK_SIZE = 1_000
/** KTD5 — the whole message is validated at 4 KiB before send. */
export const PUSH_MESSAGE_MAX_BYTES = 4_096
/** KTD15 — the budget a step keeps back before it starts another chunk. */
export const PUSH_STEP_RESERVE_MS = 40_000
/**
 * The provider retries a 429 twice on its own. A short minimum keeps that
 * retry inside our per-call deadline instead of racing it.
 */
const PROVIDER_RETRY_MIN_TIMEOUT_MS = 250
/** The delivery row's error column is 64 characters; a code stays far below. */
const PROVIDER_CODE_MAX_LENGTH = 32

const PRE_SOCKET_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
])

const AUTH_PROVIDER_CODES = new Set([
  "UNAUTHORIZED",
  "INVALID_CREDENTIALS",
  "PUSH_TOO_MANY_EXPERIENCE_IDS",
  "INVALID_ACCESS_TOKEN",
])

const FATAL_PROVIDER_CODES = new Set([
  "MESSAGE_TOO_BIG",
  "PUSH_TOO_MANY_NOTIFICATIONS",
  "VALIDATION_ERROR",
  "INVALID_ARGUMENT",
])

export type PushSendConfig = Readonly<{
  campaignsEnabled: boolean
  batchPageSize: number
  stepMaxDurationMs: number
  stepReserveMs: number
  chunkDeadlineMs: number
  providerConcurrency: number
  messagesPerSecond: number
  receiptPageSize: number
  blockedCountries: string[]
}>

export type PushTransportMessage = Readonly<{
  token: string
  title: string
  body: string
  data: Record<string, string>
}>

export type PushSendOutcome =
  | Readonly<{ kind: "accepted"; ticketId: string }>
  | Readonly<{ kind: "dead_token"; providerCode: string }>
  | Readonly<{ kind: "failed"; providerCode: string }>

export type PushReceiptOutcome =
  | Readonly<{ kind: "handed_off" }>
  | Readonly<{ kind: "dead_token"; providerCode: string }>
  | Readonly<{ kind: "failed"; providerCode: string }>

export type PushProviderErrorClass =
  | "retryable"
  | "indeterminate"
  | "fatal"
  | "auth"

export type PushProviderClient = {
  sendPushNotificationsAsync(
    messages: ExpoPushMessage[],
  ): Promise<ExpoPushTicket[]>
  getPushNotificationReceiptsAsync(
    receiptIds: string[],
  ): Promise<Record<string, ExpoPushReceipt>>
}

export type PushTransport = Readonly<{
  sendChunk(
    messages: readonly PushTransportMessage[],
  ): Promise<PushSendOutcome[]>
  fetchReceipts(
    ticketIds: readonly string[],
  ): Promise<Map<string, PushReceiptOutcome>>
}>

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * The send knobs, with the sizing table as the fallback for each.
 *
 * The defaults live here as well as on the Zod schemas because `skipValidation`
 * is on in tests and Zod defaults do not apply there.
 */
export function resolvePushSendConfig(): PushSendConfig {
  const stepMaxDurationMs = positiveInteger(
    env.PUSH_STEP_MAX_DURATION_MS,
    220_000,
  )
  return {
    campaignsEnabled: env.PUSH_CAMPAIGNS_ENABLED === "true",
    batchPageSize: positiveInteger(env.PUSH_BATCH_PAGE_SIZE, 5_000),
    stepMaxDurationMs,
    stepReserveMs: Math.min(
      PUSH_STEP_RESERVE_MS,
      Math.floor(stepMaxDurationMs / 2),
    ),
    chunkDeadlineMs: positiveInteger(env.PUSH_CHUNK_DEADLINE_MS, 10_000),
    providerConcurrency: positiveInteger(env.PUSH_PROVIDER_CONCURRENCY, 3),
    messagesPerSecond: positiveInteger(env.PUSH_MESSAGES_PER_SECOND, 500),
    receiptPageSize: positiveInteger(env.PUSH_RECEIPT_PAGE_SIZE, 10_000),
    blockedCountries: resolvePushFcmBlockedCountries(
      env.PUSH_FCM_BLOCKED_COUNTRIES,
    ),
  }
}

/** KTD1 — the access token is required in production, and only there. */
export function pushTransportAccessTokenRequired(
  nodeEnv: string | undefined = env.NODE_ENV,
): boolean {
  return nodeEnv === "production"
}

type RateBucket = { nextAvailableAt: number }

function rateBucket(): RateBucket {
  const global = globalThis as typeof globalThis & {
    __forgePushSendRateBucket?: RateBucket
  }
  const current = global.__forgePushSendRateBucket
  if (current) return current
  const bucket: RateBucket = { nextAvailableAt: 0 }
  global.__forgePushSendRateBucket = bucket
  return bucket
}

/** Test seam: forgets the pacing window. */
export function resetPushSendRateBucket(): void {
  rateBucket().nextAvailableAt = 0
}

/**
 * Reserves room for `count` messages and returns the wait in milliseconds.
 *
 * The bucket paces rather than bursts: a window already in the past is
 * forgotten, so an idle worker does not bank credit it never earned.
 */
export function reservePushSendWindow(
  count: number,
  messagesPerSecond: number,
  now: number = Date.now(),
): number {
  const bucket = rateBucket()
  const start = Math.max(now, bucket.nextAvailableAt)
  bucket.nextAvailableAt = start + (count / messagesPerSecond) * 1_000
  return start - now
}

async function acquirePushSendWindow(
  count: number,
  messagesPerSecond: number,
): Promise<void> {
  const wait = reservePushSendWindow(count, messagesPerSecond)
  if (wait <= 0) return
  await new Promise((resolve) => setTimeout(resolve, wait))
}

function typedCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined
  const code = (error as { code?: unknown }).code
  if (typeof code === "string" && code.length > 0) return code
  const cause = (error as { cause?: { code?: unknown } }).cause
  const causeCode = cause?.code
  return typeof causeCode === "string" && causeCode.length > 0
    ? causeCode
    : undefined
}

function typedStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined
  const status = (error as { statusCode?: unknown }).statusCode
  return typeof status === "number" ? status : undefined
}

/**
 * KTD3's error classes, read from codes only.
 *
 * `indeterminate` is the default on purpose: an unrecognised failure may have
 * reached the provider, and reverting it would duplicate the send.
 */
export function classifyPushProviderError(
  error: unknown,
): PushProviderErrorClass {
  if (error instanceof PushProviderRetryableError) return "retryable"
  if (error instanceof PushProviderAuthError) return "auth"
  if (error instanceof PushProviderFatalError) return "fatal"
  if (error instanceof PushProviderIndeterminateError) return "indeterminate"

  const code = typedCode(error)
  const status = typedStatus(error)
  if (status === 429) return "retryable"
  if (code && PRE_SOCKET_CODES.has(code)) return "retryable"
  if (status === 401 || status === 403) return "auth"
  if (code && AUTH_PROVIDER_CODES.has(code)) return "auth"
  if (code && FATAL_PROVIDER_CODES.has(code)) return "fatal"
  if (status === 400 || status === 413 || status === 422) return "fatal"
  return "indeterminate"
}

/** The provider's code, bounded. Never the provider's message. */
export function providerErrorCode(error: unknown): string {
  const code = typedCode(error)
  if (code) return code.slice(0, PROVIDER_CODE_MAX_LENGTH)
  const status = typedStatus(error)
  if (status !== undefined) return `http_${status}`
  return "unclassified"
}

function raiseProviderError(error: unknown): never {
  const code = providerErrorCode(error)
  switch (classifyPushProviderError(error)) {
    case "retryable":
      throw new PushProviderRetryableError(code)
    case "auth":
      throw new PushProviderAuthError(code)
    case "fatal":
      throw new PushProviderFatalError(code)
    default:
      throw new PushProviderIndeterminateError(code)
  }
}

/**
 * Races a provider call against its budget. A timeout is indeterminate,
 * because the request may still reach the provider after we stop waiting.
 */
export function withPushProviderDeadline<T>(
  promise: Promise<T>,
  budgetMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new PushProviderIndeterminateError("provider_timeout")),
      budgetMs,
    )
  })
  // The loser of the race keeps running, so its later rejection needs a
  // handler or it escapes as an unhandled rejection and kills the worker.
  promise.catch(() => {})
  return Promise.race([promise, deadline]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

function messageByteLength(message: ExpoPushMessage): number {
  return Buffer.byteLength(JSON.stringify(message), "utf8")
}

function toProviderMessage(message: PushTransportMessage): ExpoPushMessage {
  return {
    to: message.token,
    title: message.title,
    body: message.body,
    data: message.data,
    sound: "default",
    priority: "high",
    channelId: PUSH_ANDROID_CHANNEL_ID,
  }
}

function ticketOutcome(ticket: ExpoPushTicket): PushSendOutcome {
  if (ticket.status === "ok") return { kind: "accepted", ticketId: ticket.id }
  const providerCode = ticket.details?.error ?? "provider_error"
  return providerCode === "DeviceNotRegistered"
    ? { kind: "dead_token", providerCode }
    : { kind: "failed", providerCode }
}

function receiptOutcome(receipt: ExpoPushReceipt): PushReceiptOutcome {
  if (receipt.status === "ok") return { kind: "handed_off" }
  const providerCode = receipt.details?.error ?? "provider_error"
  return providerCode === "DeviceNotRegistered"
    ? { kind: "dead_token", providerCode }
    : { kind: "failed", providerCode }
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

export function createPushTransport(
  options: {
    accessToken?: string
    accessTokenRequired?: boolean
    client?: PushProviderClient
    config?: PushSendConfig
  } = {},
): PushTransport {
  const config = options.config ?? resolvePushSendConfig()
  const accessToken = options.accessToken ?? env.EXPO_ACCESS_TOKEN
  const required =
    options.accessTokenRequired ?? pushTransportAccessTokenRequired()
  if (required && !accessToken?.trim()) {
    throw new PushTransportConfigurationError(
      "A push send needs EXPO_ACCESS_TOKEN on this service",
    )
  }
  const client: PushProviderClient =
    options.client ??
    new Expo({
      accessToken,
      maxConcurrentRequests: config.providerConcurrency,
      retryMinTimeout: PROVIDER_RETRY_MIN_TIMEOUT_MS,
    })

  return {
    async sendChunk(messages) {
      if (messages.length > PUSH_PROVIDER_CHUNK_SIZE) {
        throw new PushProviderFatalError("chunk_too_large")
      }
      const outcomes = new Array<PushSendOutcome | undefined>(messages.length)
      const sendable: { index: number; message: ExpoPushMessage }[] = []
      for (const [index, message] of messages.entries()) {
        const provider = toProviderMessage(message)
        if (messageByteLength(provider) > PUSH_MESSAGE_MAX_BYTES) {
          outcomes[index] = { kind: "failed", providerCode: "message_too_big" }
          continue
        }
        sendable.push({ index, message: provider })
      }
      if (sendable.length === 0) return outcomes as PushSendOutcome[]

      await acquirePushSendWindow(sendable.length, config.messagesPerSecond)
      let tickets: ExpoPushTicket[]
      try {
        tickets = await withPushProviderDeadline(
          client.sendPushNotificationsAsync(
            sendable.map((entry) => entry.message),
          ),
          config.chunkDeadlineMs,
        )
      } catch (error) {
        raiseProviderError(error)
      }
      if (tickets.length !== sendable.length) {
        throw new PushProviderIndeterminateError("ticket_count_mismatch")
      }
      for (const [position, entry] of sendable.entries()) {
        outcomes[entry.index] = ticketOutcome(tickets[position])
      }
      return outcomes as PushSendOutcome[]
    },

    async fetchReceipts(ticketIds) {
      const receipts = new Map<string, PushReceiptOutcome>()
      // The caller pages at PUSH_RECEIPT_CHUNK_SIZE; each request is split
      // again at the provider's own 300-id limit.
      for (const page of chunk(ticketIds, PUSH_RECEIPT_CHUNK_SIZE)) {
        for (const request of chunk(
          page,
          Expo.pushNotificationReceiptChunkSizeLimit,
        )) {
          let answered: Record<string, ExpoPushReceipt>
          try {
            answered = await withPushProviderDeadline(
              client.getPushNotificationReceiptsAsync([...request]),
              config.chunkDeadlineMs,
            )
          } catch (error) {
            raiseProviderError(error)
          }
          for (const [ticketId, receipt] of Object.entries(answered)) {
            receipts.set(ticketId, receiptOutcome(receipt))
          }
        }
      }
      return receipts
    },
  }
}
