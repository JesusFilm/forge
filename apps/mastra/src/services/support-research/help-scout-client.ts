import { z } from "zod"

import type { SupportResearchConfig } from "../../config/env"
import {
  discardResponseBody,
  readResponseJsonCapped,
} from "../devotional/bounded-response"

const linkSchema = z.object({ href: z.string().url() }).passthrough()

const conversationSchema = z
  .object({
    id: z.union([z.number().int().nonnegative(), z.string().min(1)]),
    subject: z.string().nullish(),
    createdAt: z.string().datetime({ offset: true }),
    mailboxId: z
      .union([z.number().int().nonnegative(), z.string().min(1)])
      .optional(),
    mailbox: z
      .object({
        id: z.union([z.number().int().nonnegative(), z.string().min(1)]),
      })
      .passthrough()
      .optional(),
    _links: z.object({ web: linkSchema.optional() }).passthrough().optional(),
  })
  .passthrough()

const conversationsPageSchema = z
  .object({
    _embedded: z
      .object({ conversations: z.array(conversationSchema) })
      .passthrough(),
    _links: z.object({ next: linkSchema.optional() }).passthrough().optional(),
  })
  .passthrough()

const threadSchema = z
  .object({
    id: z.union([z.number().int().nonnegative(), z.string().min(1)]),
    type: z.string().optional(),
    body: z.string().nullish(),
    createdAt: z.string().datetime({ offset: true }).optional(),
  })
  .passthrough()

const threadsPageSchema = z
  .object({
    _embedded: z.object({ threads: z.array(threadSchema) }).passthrough(),
    _links: z.object({ next: linkSchema.optional() }).passthrough().optional(),
  })
  .passthrough()

const tokenSchema = z
  .object({
    access_token: z.string().min(1),
    expires_in: z.number().int().positive().default(172_800),
    token_type: z.string().optional(),
  })
  .passthrough()

export type HelpScoutConversation = {
  id: string
  mailboxId: string
  subject: string
  createdAt: string
  sourceUrl?: string
}

export type HelpScoutThread = {
  id: string
  type?: string
  body: string
  createdAt?: string
}

export type HelpScoutFailureReason =
  | "config_missing"
  | "invalid_config"
  | "auth_failed"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "rejected"
  | "parse_error"
  | "response_too_large"
  | "unsafe_redirect"
  | "not_found"

export type HelpScoutFailure = {
  ok: false
  reason: HelpScoutFailureReason
  retryable: boolean
  status?: number
}

export type HelpScoutResult<T> = { ok: true; value: T } | HelpScoutFailure

export const MAX_HELP_SCOUT_MAILBOXES = 50

type ClientConfig = Pick<
  SupportResearchConfig,
  "timeoutMs" | "maxResponseBytes" | "maxThreadsPerConversation"
> & {
  helpScout: SupportResearchConfig["helpScout"]
}

type TokenCache = { value: string; expiresAt: number }

function normalizeBaseUrl(value: string): URL | undefined {
  try {
    const url = new URL(value.endsWith("/") ? value : `${value}/`)
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    ) {
      return
    }
    return url
  } catch {
    return
  }
}

function decodePathId(value: string): string | undefined {
  try {
    return decodeURIComponent(value)
  } catch {
    return
  }
}

function normalizeHttpsUrl(value: string): URL | undefined {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username || url.password) return
    return url
  } catch {
    return
  }
}

function safeConversationWebUrl(value: string | undefined): string | undefined {
  if (!value) return
  const url = normalizeHttpsUrl(value)
  if (!url || url.hostname !== "secure.helpscout.net" || url.port) return
  url.hash = ""
  return url.href
}

function failureForStatus(status: number): HelpScoutFailure {
  if (status === 401 || status === 403) {
    return { ok: false, reason: "auth_failed", retryable: false, status }
  }
  if (status === 404) {
    return { ok: false, reason: "not_found", retryable: false, status }
  }
  if (status === 429) {
    return { ok: false, reason: "rate_limited", retryable: true, status }
  }
  return {
    ok: false,
    reason: status >= 500 ? "network_error" : "rejected",
    retryable: status >= 500,
    status,
  }
}

function classifyFetchError(error: unknown): HelpScoutFailure {
  const name = (error as { name?: string } | undefined)?.name
  return name === "TimeoutError" || name === "AbortError"
    ? { ok: false, reason: "timeout", retryable: true }
    : { ok: false, reason: "network_error", retryable: true }
}

export class HelpScoutClient {
  private token?: TokenCache
  private readonly apiBase: URL | undefined
  private readonly authUrl: URL | undefined

  constructor(
    private readonly config: ClientConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    const apiBase = normalizeBaseUrl(config.helpScout.apiUrl)
    this.apiBase =
      apiBase?.hostname === "api.helpscout.net" && apiBase.pathname === "/v2/"
        ? apiBase
        : undefined
    const authUrl = normalizeHttpsUrl(config.helpScout.authUrl)
    this.authUrl =
      this.apiBase &&
      authUrl?.origin === this.apiBase.origin &&
      authUrl.pathname === "/v2/oauth2/token" &&
      !authUrl.port &&
      !authUrl.search &&
      !authUrl.hash
        ? authUrl
        : undefined
  }

  async listNewConversations(input: {
    createdAfter: Date
    createdBefore: Date
    maxConversations: number
  }): Promise<
    HelpScoutResult<{
      conversations: HelpScoutConversation[]
      capped: boolean
      pages: number
    }>
  > {
    if (
      !this.config.helpScout.clientId ||
      !this.config.helpScout.clientSecret ||
      this.config.helpScout.mailboxIds.length === 0
    ) {
      return { ok: false, reason: "config_missing", retryable: false }
    }
    if (!this.apiBase || !this.authUrl) {
      return { ok: false, reason: "invalid_config", retryable: false }
    }
    if (this.config.helpScout.mailboxIds.length > MAX_HELP_SCOUT_MAILBOXES) {
      return { ok: false, reason: "invalid_config", retryable: false }
    }

    const byId = new Map<string, HelpScoutConversation>()
    let capped = false
    let pages = 0
    const pageBudgetPerMailbox = Math.max(
      1,
      Math.floor(
        input.maxConversations / this.config.helpScout.mailboxIds.length,
      ),
    )
    for (const mailboxId of this.config.helpScout.mailboxIds) {
      let mailboxCount = 0
      let mailboxPages = 0
      const firstPage = new URL("conversations", this.apiBase)
      firstPage.searchParams.set("mailbox", mailboxId)
      firstPage.searchParams.set("status", "all")
      firstPage.searchParams.set("sortField", "createdAt")
      firstPage.searchParams.set("sortOrder", "asc")
      firstPage.searchParams.set(
        "query",
        `(createdAt:[${input.createdAfter.toISOString()} TO ${input.createdBefore.toISOString()}])`,
      )

      let next: URL | undefined = firstPage
      while (next) {
        if (mailboxPages >= pageBudgetPerMailbox) {
          capped = true
          break
        }
        pages += 1
        mailboxPages += 1
        const pageResult = await this.getJson(next, conversationsPageSchema)
        if (!pageResult.ok) return pageResult
        const pageConversations = pageResult.value._embedded.conversations
        const nextHref = pageResult.value._links?.next?.href
        for (const [index, conversation] of pageConversations.entries()) {
          const id = String(conversation.id)
          byId.set(id, {
            id,
            mailboxId: String(
              conversation.mailboxId ?? conversation.mailbox?.id ?? mailboxId,
            ),
            subject: conversation.subject ?? "",
            createdAt: conversation.createdAt,
            sourceUrl: safeConversationWebUrl(conversation._links?.web?.href),
          })
          mailboxCount += 1
          if (mailboxCount >= input.maxConversations) {
            capped ||= index < pageConversations.length - 1 || Boolean(nextHref)
            next = undefined
            break
          }
        }
        if (!next) break
        if (!nextHref) break
        const validated = this.validateApiUrl(nextHref, "/v2/conversations")
        if (!validated) {
          return { ok: false, reason: "unsafe_redirect", retryable: false }
        }
        next = validated
      }
    }

    const conversations = [...byId.values()].sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    )
    if (conversations.length > input.maxConversations) capped = true

    return {
      ok: true,
      value: {
        conversations: conversations.slice(0, input.maxConversations),
        capped,
        pages,
      },
    }
  }

  async listThreads(conversationId: string): Promise<
    HelpScoutResult<{
      threads: HelpScoutThread[]
      mergedIntoId?: string
      capped: boolean
      pages: number
    }>
  > {
    if (!this.apiBase) {
      return { ok: false, reason: "invalid_config", retryable: false }
    }
    const start = new URL(
      `conversations/${encodeURIComponent(conversationId)}/threads`,
      this.apiBase,
    )
    let next: URL | undefined = start
    let mergedIntoId: string | undefined
    const threads: HelpScoutThread[] = []
    let pages = 0
    let capped = false

    while (next && pages < this.config.maxThreadsPerConversation) {
      pages += 1
      const response = await this.authorizedGet(next, "manual")
      if (!response.ok) return response
      const rawResponse = response.value

      if ([301, 302, 307, 308].includes(rawResponse.status)) {
        const location = rawResponse.headers.get("location")
        await discardResponseBody(rawResponse)
        const target = location
          ? this.validateApiUrl(location, "/v2/conversations/")
          : undefined
        const match = target?.pathname.match(
          /\/v2\/conversations\/([^/]+)(?:\/threads)?$/,
        )
        if (!target || !match?.[1]) {
          return { ok: false, reason: "unsafe_redirect", retryable: false }
        }
        mergedIntoId = decodePathId(match[1])
        if (!mergedIntoId) {
          return { ok: false, reason: "unsafe_redirect", retryable: false }
        }
        next = new URL(
          `conversations/${encodeURIComponent(mergedIntoId)}/threads`,
          this.apiBase,
        )
        continue
      }
      if (!rawResponse.ok) {
        await discardResponseBody(rawResponse)
        return failureForStatus(rawResponse.status)
      }

      const body = await readResponseJsonCapped(
        rawResponse,
        this.config.maxResponseBytes,
      )
      if (body === undefined) {
        return { ok: false, reason: "response_too_large", retryable: false }
      }
      const parsed = threadsPageSchema.safeParse(body)
      if (!parsed.success) {
        return { ok: false, reason: "parse_error", retryable: false }
      }
      const pageThreads = parsed.data._embedded.threads
      for (const [index, thread] of pageThreads.entries()) {
        if (!thread.body) continue
        threads.push({
          id: String(thread.id),
          type: thread.type,
          body: thread.body,
          createdAt: thread.createdAt,
        })
        if (threads.length >= this.config.maxThreadsPerConversation) {
          capped ||=
            index < pageThreads.length - 1 ||
            Boolean(parsed.data._links?.next?.href)
          break
        }
      }
      const href = parsed.data._links?.next?.href
      if (!href) {
        next = undefined
        break
      }
      if (threads.length >= this.config.maxThreadsPerConversation) {
        next = undefined
        break
      }
      const validated = this.validateApiUrl(href, "/v2/conversations/")
      if (!validated) {
        return { ok: false, reason: "unsafe_redirect", retryable: false }
      }
      next = validated
    }

    if (next && pages >= this.config.maxThreadsPerConversation) capped = true

    return { ok: true, value: { threads, mergedIntoId, capped, pages } }
  }

  private async getJson<T>(
    url: URL,
    schema: z.ZodType<T>,
  ): Promise<HelpScoutResult<T>> {
    const response = await this.authorizedGet(url, "error")
    if (!response.ok) return response
    if (!response.value.ok) {
      await discardResponseBody(response.value)
      return failureForStatus(response.value.status)
    }
    const body = await readResponseJsonCapped(
      response.value,
      this.config.maxResponseBytes,
    )
    if (body === undefined) {
      return { ok: false, reason: "response_too_large", retryable: false }
    }
    const parsed = schema.safeParse(body)
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, reason: "parse_error", retryable: false }
  }

  private async authorizedGet(
    url: URL,
    redirect: RequestRedirect,
    refreshed = false,
  ): Promise<HelpScoutResult<Response>> {
    if (!this.validateApiUrl(url.href, "/v2/")) {
      return { ok: false, reason: "invalid_config", retryable: false }
    }
    const token = await this.getToken(refreshed)
    if (!token.ok) return token
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          authorization: `Bearer ${token.value}`,
          accept: "application/hal+json, application/json",
          "user-agent": "forge-mastra-support-research/1.0",
        },
        redirect,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      })
    } catch (error) {
      return classifyFetchError(error)
    }
    if (response.status === 401 && !refreshed) {
      await discardResponseBody(response)
      this.token = undefined
      return this.authorizedGet(url, redirect, true)
    }
    return { ok: true, value: response }
  }

  private async getToken(
    forceRefresh: boolean,
  ): Promise<HelpScoutResult<string>> {
    if (
      !forceRefresh &&
      this.token &&
      this.token.expiresAt - 60_000 > this.now()
    ) {
      return { ok: true, value: this.token.value }
    }
    if (
      !this.authUrl ||
      !this.config.helpScout.clientId ||
      !this.config.helpScout.clientSecret
    ) {
      return { ok: false, reason: "config_missing", retryable: false }
    }

    let response: Response
    try {
      response = await this.fetchImpl(this.authUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "user-agent": "forge-mastra-support-research/1.0",
        },
        body: JSON.stringify({
          grant_type: "client_credentials",
          client_id: this.config.helpScout.clientId,
          client_secret: this.config.helpScout.clientSecret,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(this.config.timeoutMs),
      })
    } catch (error) {
      return classifyFetchError(error)
    }
    if (!response.ok) {
      await discardResponseBody(response)
      return failureForStatus(response.status)
    }
    const body = await readResponseJsonCapped(
      response,
      this.config.maxResponseBytes,
    )
    const parsed = tokenSchema.safeParse(body)
    if (!parsed.success) {
      return { ok: false, reason: "parse_error", retryable: false }
    }
    this.token = {
      value: parsed.data.access_token,
      expiresAt: this.now() + parsed.data.expires_in * 1_000,
    }
    return { ok: true, value: this.token.value }
  }

  private validateApiUrl(
    value: string,
    requiredPathPrefix: string,
  ): URL | undefined {
    if (!this.apiBase) return
    try {
      const url = new URL(value, this.apiBase)
      if (
        url.protocol !== "https:" ||
        url.origin !== this.apiBase.origin ||
        url.username ||
        url.password ||
        !url.pathname.startsWith(requiredPathPrefix)
      ) {
        return
      }
      return url
    } catch {
      return
    }
  }
}
