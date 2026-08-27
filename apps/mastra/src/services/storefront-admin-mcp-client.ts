import { randomUUID } from "node:crypto"

import {
  getStorefrontCuratorConfig,
  type StorefrontCuratorConfig,
} from "../config/env"

export type StorefrontMcpFailureReason =
  | "config_missing"
  | "ssrf_blocked"
  | "auth_failed"
  | "timeout"
  | "network_error"
  | "rate_limited"
  | "rejected"
  | "parse_error"
  | "rpc_error"

export type StorefrontMcpResult<T> =
  | { ok: true; data: T }
  | {
      ok: false
      reason: StorefrontMcpFailureReason
      retryable: boolean
      status?: number
      rpcCode?: number
      detail?: "mcp_url_missing" | "oauth_credentials_missing"
    }

export type StorefrontAdminMcpClientConfig = Pick<
  StorefrontCuratorConfig,
  | "mcpUrl"
  | "allowedHosts"
  | "accessToken"
  | "authIssuerUrl"
  | "clientId"
  | "refreshToken"
  | "timeoutMs"
  | "maxResponseBytes"
  | "userAgent"
>

type TokenState = {
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
}

type JsonRpcEnvelope = {
  result?: { structuredContent?: unknown }
  error?: { code?: unknown }
}

const READ_ONLY_STOREFRONT_TOOLS = new Set([
  "storefront.homepage.context",
  "experience.locale.validate",
  "experience.media.check",
])
const DEFAULT_RETRY_DELAY_MS = 25

function allowedHost(urlValue: string, allowedHostsCsv?: string): boolean {
  if (!allowedHostsCsv) return true
  let hostname: string
  try {
    hostname = new URL(urlValue).hostname.toLowerCase()
  } catch {
    return false
  }
  const allowed = new Set(
    allowedHostsCsv
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )
  return allowed.has(hostname)
}

function timeoutFailure(error: unknown): boolean {
  const name = (error as { name?: string } | null | undefined)?.name
  return name === "TimeoutError" || name === "AbortError"
}

async function readJsonBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  if (!response.body) return undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return undefined
      }
      chunks.push(next.value)
    }
    const merged = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(merged))
  } catch (error) {
    if (timeoutFailure(error)) throw error
    return undefined
  } finally {
    try {
      reader?.releaseLock()
    } catch {
      // Non-timeout body failures are represented by typed parse_error.
    }
  }
}

function statusFailure(status: number): StorefrontMcpResult<never> {
  if (status === 401 || status === 403) {
    return { ok: false, reason: "auth_failed", retryable: false, status }
  }
  if (status === 429) {
    return { ok: false, reason: "rate_limited", retryable: true, status }
  }
  return {
    ok: false,
    reason: status >= 400 && status < 500 ? "rejected" : "network_error",
    retryable: status >= 500,
    status,
  }
}

/**
 * Minimal JSON-RPC MCP client for Admin's stateless POST transport. It keeps
 * write authority out of the model: workflows name every mutating tool call
 * deterministically after validating the agent's bounded proposal.
 */
export class StorefrontAdminMcpClient {
  private readonly config: StorefrontAdminMcpClientConfig
  private readonly fetchImpl: typeof fetch
  private readonly waitBeforeRetry: (milliseconds: number) => Promise<void>
  private token: TokenState

  constructor(
    options: {
      config?: StorefrontAdminMcpClientConfig
      fetchImpl?: typeof fetch
      waitBeforeRetry?: (milliseconds: number) => Promise<void>
    } = {},
  ) {
    this.config = options.config ?? getStorefrontCuratorConfig()
    this.fetchImpl = options.fetchImpl ?? fetch
    this.waitBeforeRetry =
      options.waitBeforeRetry ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)))
    this.token = {
      accessToken: this.config.accessToken,
      refreshToken: this.config.refreshToken,
    }
  }

  async callTool<T = unknown>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<StorefrontMcpResult<T>> {
    if (!this.config.mcpUrl) {
      return {
        ok: false,
        reason: "config_missing",
        retryable: false,
        detail: "mcp_url_missing",
      }
    }
    if (!allowedHost(this.config.mcpUrl, this.config.allowedHosts)) {
      return { ok: false, reason: "ssrf_blocked", retryable: false }
    }

    const token = await this.getAccessToken(false)
    if (!token.ok) return token
    const first = await this.request<T>(name, args, token.data)
    if (first.ok || !READ_ONLY_STOREFRONT_TOOLS.has(name)) return first

    let accessToken = token.data
    if (first.reason === "auth_failed" && this.canRefresh()) {
      const refreshed = await this.getAccessToken(true)
      if (!refreshed.ok) return refreshed
      accessToken = refreshed.data
    } else if (!first.retryable) {
      return first
    }
    await this.waitBeforeRetry(DEFAULT_RETRY_DELAY_MS)
    return this.request<T>(name, args, accessToken)
  }

  private canRefresh(): boolean {
    return Boolean(
      this.config.authIssuerUrl &&
      this.config.clientId &&
      this.token.refreshToken,
    )
  }

  private async getAccessToken(
    forceRefresh: boolean,
  ): Promise<StorefrontMcpResult<string>> {
    if (
      !forceRefresh &&
      this.token.accessToken &&
      (!this.token.expiresAt || this.token.expiresAt > Date.now() + 60_000)
    ) {
      return { ok: true, data: this.token.accessToken }
    }
    if (!this.canRefresh()) {
      return {
        ok: false,
        reason: "config_missing",
        retryable: false,
        detail: "oauth_credentials_missing",
      }
    }

    const issuer = this.config.authIssuerUrl as string
    if (!allowedHost(issuer, this.config.allowedHosts)) {
      return { ok: false, reason: "ssrf_blocked", retryable: false }
    }
    // OAuth refresh rotates credential state at Auth. A lost success response
    // is therefore ambiguous: retrying with the old token can trigger reuse
    // detection and revoke the whole family. Keep refresh single-attempt; the
    // operator must resolve credential state before another scheduled run.
    return this.refreshAccessTokenOnce()
  }

  private async refreshAccessTokenOnce(): Promise<StorefrontMcpResult<string>> {
    const issuer = this.config.authIssuerUrl as string
    let response: Response
    try {
      response = await this.fetchImpl(
        new URL("/api/auth/oauth2/token", issuer),
        {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "user-agent": this.config.userAgent,
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: this.token.refreshToken as string,
            client_id: this.config.clientId as string,
          }),
          redirect: "error",
          signal: AbortSignal.timeout(this.config.timeoutMs),
        },
      )
    } catch (error) {
      return {
        ok: false,
        reason: timeoutFailure(error) ? "timeout" : "network_error",
        retryable: true,
      }
    }
    if (!response.ok) return statusFailure(response.status)
    let body: unknown
    try {
      body = await readJsonBodyCapped(response, this.config.maxResponseBytes)
    } catch (error) {
      return {
        ok: false,
        reason: timeoutFailure(error) ? "timeout" : "network_error",
        retryable: true,
      }
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { ok: false, reason: "parse_error", retryable: false }
    }
    const record = body as Record<string, unknown>
    if (typeof record.access_token !== "string" || !record.access_token) {
      return { ok: false, reason: "parse_error", retryable: false }
    }
    const accessToken = record.access_token
    this.token = {
      accessToken,
      refreshToken:
        typeof record.refresh_token === "string" && record.refresh_token
          ? record.refresh_token
          : this.token.refreshToken,
      expiresAt:
        typeof record.expires_in === "number" && record.expires_in > 0
          ? Date.now() + record.expires_in * 1_000
          : undefined,
    }
    return { ok: true, data: accessToken }
  }

  private async request<T>(
    name: string,
    args: Record<string, unknown>,
    accessToken: string,
  ): Promise<StorefrontMcpResult<T>> {
    let response: Response
    try {
      response = await this.fetchImpl(this.config.mcpUrl as string, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "user-agent": this.config.userAgent,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: randomUUID(),
          method: "tools/call",
          params: { name, arguments: args },
        }),
        redirect: "error",
        signal: AbortSignal.timeout(this.config.timeoutMs),
      })
    } catch (error) {
      return {
        ok: false,
        reason: timeoutFailure(error) ? "timeout" : "network_error",
        retryable: true,
      }
    }
    if (!response.ok) return statusFailure(response.status)
    let body: unknown
    try {
      body = await readJsonBodyCapped(response, this.config.maxResponseBytes)
    } catch (error) {
      return {
        ok: false,
        reason: timeoutFailure(error) ? "timeout" : "network_error",
        retryable: true,
      }
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { ok: false, reason: "parse_error", retryable: false }
    }
    const envelope = body as JsonRpcEnvelope
    if (envelope.error) {
      return {
        ok: false,
        reason: "rpc_error",
        retryable: envelope.error.code === -32_603,
        rpcCode:
          typeof envelope.error.code === "number"
            ? envelope.error.code
            : undefined,
      }
    }
    if (
      !envelope.result ||
      typeof envelope.result !== "object" ||
      Array.isArray(envelope.result) ||
      !("structuredContent" in envelope.result)
    ) {
      return { ok: false, reason: "parse_error", retryable: false }
    }
    return { ok: true, data: envelope.result.structuredContent as T }
  }
}

let defaultClient: StorefrontAdminMcpClient | undefined

export function getStorefrontAdminMcpClient(): StorefrontAdminMcpClient {
  defaultClient ??= new StorefrontAdminMcpClient()
  return defaultClient
}
