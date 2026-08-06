import { createAuthEndpoint, getSessionFromCtx } from "better-auth/api"
import { APIError } from "better-auth/api"
import { z } from "zod"

import { logDeviceEvent } from "@/auth/device-log"
import { getAuthBaseUrl } from "@/config/env"
import { prisma } from "@/db/client"
import {
  DEVICE_GRANT_TYPE,
  isDeviceGrantEnabled,
  resolveDeviceClient,
} from "@/services/device-client.service"
import {
  DeviceGrantError,
  approveDeviceCode,
  denyDeviceCode,
  findPendingByUserCode,
  issueDeviceCode,
  pollDeviceCode,
  recordUserCodeAttempt,
} from "@/services/device-grant.service"
import { buildAuthorizationCode } from "@/services/oauth-authorization-code.service"

/**
 * RFC 8628 device authorization grant for the TV app.
 *
 * Deliberately NOT better-auth's bundled `deviceAuthorization()` plugin. That
 * one stores codes in plaintext, redeems with a non-atomic
 * `findOne -> branch -> delete`, and returns a better-auth *session* token —
 * which has no `jfp_at_` prefix, no refresh token, no audience, none of the
 * custom claims, and does not introspect through admin. Every one of those is a
 * requirement here, so registering it would only leave five weaker endpoints
 * live beside these.
 *
 * The approved poll mints a real OAuth authorization code and exchanges it at
 * the provider's own `/oauth2/token`. Tokens therefore come from the same
 * issuance path as every other first-party client, rather than a parallel
 * implementation that could drift from it.
 */

const DEVICE_CODE_EXPIRES_IN_MS = 15 * 60 * 1000
const DEVICE_POLL_INTERVAL_MS = 5 * 1000
const AUTHORIZATION_CODE_EXPIRES_IN_MS = 60 * 1000

/** Shape returned by the provider's token endpoint on success. */
type TokenEnvelope = Record<string, unknown>

export type ExchangeAuthorizationCode = (input: {
  code: string
  clientId: string
  redirectUri: string
  codeVerifier: string
}) => Promise<TokenEnvelope>

/**
 * Injectable so the plugin is testable without booting the whole auth instance,
 * and so the one place that depends on the provider's internals is visible. The
 * default resolves `auth` lazily: this module is imported *by* the auth config,
 * so a static import would be a cycle.
 */
const defaultExchangeAuthorizationCode: ExchangeAuthorizationCode = async ({
  code,
  clientId,
  redirectUri,
  codeVerifier,
}) => {
  const { auth } = await import("@/auth/config")
  return (await auth.api.oauth2Token({
    body: {
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    },
  })) as TokenEnvelope
}

export type DeviceGrantPluginOptions = {
  exchangeAuthorizationCode?: ExchangeAuthorizationCode
  deviceCodeExpiresInMs?: number
  pollIntervalMs?: number
}

function oauthError(
  status: "BAD_REQUEST" | "FORBIDDEN" | "SERVICE_UNAVAILABLE" | "UNAUTHORIZED",
  error: string,
  description: string,
): APIError {
  return new APIError(status, { error, error_description: description })
}

/**
 * Every device-grant failure is a 400, including `access_denied`. RFC 8628 §3.5
 * puts the outcome in the `error` field rather than the status code, and a
 * polling client that switched on status would misread a denial as a transport
 * problem.
 */
function toApiError(error: DeviceGrantError): APIError {
  return oauthError("BAD_REQUEST", error.code, error.description)
}

/**
 * The kill switch returns 503 from the request path rather than throwing at
 * boot. `apps/auth` serves six live clients; a boot throw over an optional new
 * grant would 500 every route including login for all of them, and TV binaries
 * cannot be rolled back for weeks. Enforcement belongs where the blast radius
 * is one endpoint. See
 * docs/solutions/architecture-patterns/fail-closed-enforcement-point-follows-rollback-capability.md
 */
function assertEnabled(): void {
  if (isDeviceGrantEnabled()) return
  logDeviceEvent("disabled_request_rejected")
  throw oauthError(
    "SERVICE_UNAVAILABLE",
    "temporarily_unavailable",
    "Device sign-in is not available.",
  )
}

export function deviceGrantPlugin(options: DeviceGrantPluginOptions = {}) {
  const exchangeAuthorizationCode =
    options.exchangeAuthorizationCode ?? defaultExchangeAuthorizationCode
  const deviceCodeExpiresInMs =
    options.deviceCodeExpiresInMs ?? DEVICE_CODE_EXPIRES_IN_MS
  const pollIntervalMs = options.pollIntervalMs ?? DEVICE_POLL_INTERVAL_MS

  return {
    id: "device-grant",
    endpoints: {
      deviceGrantCode: createAuthEndpoint(
        "/device/code",
        {
          method: "POST",
          body: z.object({
            client_id: z.string().min(1),
            scope: z.string().optional(),
            code_challenge: z.string().min(43).max(128),
            code_challenge_method: z.literal("S256"),
          }),
        },
        async (ctx) => {
          assertEnabled()

          const client = await resolveDeviceClient(prisma, ctx.body.client_id)
          if (!client) {
            logDeviceEvent("code_rejected", {
              reason: "unknown_client",
              attemptedClientId: ctx.body.client_id,
            })
            throw oauthError(
              "BAD_REQUEST",
              "invalid_client",
              "Unknown client for the device grant.",
            )
          }

          // The plugin enforces scope against the client's registration. The
          // bundled better-auth plugin does not check scope at all, and the
          // provider never sees this request, so this is the only gate.
          const requested = ctx.body.scope?.trim()
            ? ctx.body.scope.trim().split(/\s+/)
            : client.scopes
          const unknown = requested.filter(
            (scope) => !client.scopes.includes(scope),
          )
          if (unknown.length > 0) {
            logDeviceEvent("code_rejected", {
              reason: "invalid_scope",
              clientId: client.clientId,
            })
            throw oauthError(
              "BAD_REQUEST",
              "invalid_scope",
              "Requested scope is not registered for this client.",
            )
          }

          const issued = await issueDeviceCode(prisma, {
            clientId: client.clientId,
            scopes: requested,
            codeChallenge: ctx.body.code_challenge,
            codeChallengeMethod: ctx.body.code_challenge_method,
            expiresInMs: deviceCodeExpiresInMs,
            pollingIntervalMs: pollIntervalMs,
          })

          const verificationUri = new URL("/device", getAuthBaseUrl())
          const verificationUriComplete = new URL(verificationUri)
          verificationUriComplete.searchParams.set("user_code", issued.userCode)

          logDeviceEvent("code_issued", {
            clientId: client.clientId,
            scopes: requested.join(","),
            expiresIn: Math.floor(deviceCodeExpiresInMs / 1000),
          })

          return ctx.json(
            {
              device_code: issued.deviceCode,
              user_code: issued.userCode,
              verification_uri: verificationUri.toString(),
              verification_uri_complete: verificationUriComplete.toString(),
              expires_in: Math.floor(deviceCodeExpiresInMs / 1000),
              interval: Math.floor(pollIntervalMs / 1000),
            },
            { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
          )
        },
      ),

      deviceGrantToken: createAuthEndpoint(
        "/device/token",
        {
          method: "POST",
          body: z.object({
            grant_type: z.literal(DEVICE_GRANT_TYPE),
            device_code: z.string().min(1),
            client_id: z.string().min(1),
            code_verifier: z.string().min(43).max(128),
          }),
        },
        async (ctx) => {
          assertEnabled()

          const client = await resolveDeviceClient(prisma, ctx.body.client_id)
          if (!client) {
            logDeviceEvent("token_rejected", {
              reason: "unknown_client",
              attemptedClientId: ctx.body.client_id,
            })
            throw oauthError(
              "BAD_REQUEST",
              "invalid_grant",
              "Invalid device code.",
            )
          }

          // Claiming happens here, BEFORE the exchange below, and that ordering
          // is deliberate. It means a failed exchange burns the device code: the
          // viewer has to request a fresh one and approve again. The alternative
          // — claim after a successful exchange — would let two concurrent polls
          // both reach the provider and mint two token pairs for one approval,
          // which is the worse failure. A client seeing `invalid_grant` should
          // treat it as terminal and start a new code rather than retry.
          let claimed
          try {
            claimed = await pollDeviceCode(prisma, {
              deviceCode: ctx.body.device_code,
              clientId: client.clientId,
            })
          } catch (error) {
            if (error instanceof DeviceGrantError) {
              logDeviceEvent("token_pending", {
                outcome: error.code,
                clientId: client.clientId,
              })
              throw toApiError(error)
            }
            throw error
          }

          if (claimed.sessionId == null) {
            logDeviceEvent("token_rejected", {
              reason: "missing_session",
              clientId: client.clientId,
            })
            throw oauthError(
              "BAD_REQUEST",
              "invalid_grant",
              "Invalid device code.",
            )
          }

          // The redirect URI is a binding value, never navigated. It exists
          // because the provider's authorization_code grant requires one and
          // compares it against the code row.
          const redirectUri = client.redirectUris[0]
          if (redirectUri == null) {
            logDeviceEvent("token_rejected", {
              reason: "client_missing_redirect_uri",
              clientId: client.clientId,
            })
            throw oauthError(
              "BAD_REQUEST",
              "invalid_grant",
              "Invalid device code.",
            )
          }

          const authorizationCode = buildAuthorizationCode({
            query: {
              client_id: claimed.clientId,
              redirect_uri: redirectUri,
              scope: claimed.scopes.join(" "),
              code_challenge: claimed.codeChallenge,
              code_challenge_method: claimed.codeChallengeMethod,
            },
            userId: claimed.userId,
            sessionId: claimed.sessionId,
            codeExpiresInMs: AUTHORIZATION_CODE_EXPIRES_IN_MS,
          })

          // Both the code write and the exchange sit inside one try. The device
          // code is already consumed by this point, so anything that escapes
          // here would be a bare 500 with no `error` field — which a conforming
          // RFC 8628 client cannot classify, against a code it can never redeem
          // again. Every failure past the claim has to come back as a
          // recognisable OAuth error.
          let tokens: TokenEnvelope
          try {
            await ctx.context.internalAdapter.createVerificationValue({
              identifier: authorizationCode.identifier,
              value: authorizationCode.value,
              expiresAt: authorizationCode.expiresAt,
            })

            tokens = await exchangeAuthorizationCode({
              code: authorizationCode.code,
              clientId: claimed.clientId,
              redirectUri,
              codeVerifier: ctx.body.code_verifier,
            })
          } catch {
            // The caught error is deliberately not logged: its message can carry
            // fragments of the submitted code or verifier.
            //
            // The usual cause is a PKCE verifier that does not match the
            // challenge the device registered — a code redeemed by something
            // other than the device that requested it. It can also be the
            // approving browser session having ended between approval and this
            // poll, or the database being unavailable for the code write. All
            // three are terminal for this code; the client's move is to request
            // a new one.
            logDeviceEvent("token_exchange_failed", {
              clientId: claimed.clientId,
              claimedUserId: claimed.userId,
            })
            throw oauthError(
              "BAD_REQUEST",
              "invalid_grant",
              "Invalid device code.",
            )
          }

          logDeviceEvent("token_issued", {
            clientId: claimed.clientId,
            userId: claimed.userId,
            scopes: claimed.scopes.join(","),
          })

          return ctx.json(tokens, {
            headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
          })
        },
      ),

      deviceGrantStatus: createAuthEndpoint(
        "/device/status",
        {
          method: "GET",
          query: z.object({ user_code: z.string().min(1).max(32) }),
        },
        async (ctx) => {
          assertEnabled()

          try {
            const record = await findPendingByUserCode(prisma, {
              userCode: ctx.query.user_code,
            })
            const client = await resolveDeviceClient(prisma, record.clientId)

            return ctx.json({
              user_code: ctx.query.user_code,
              status: record.status.toLowerCase(),
              client_name: client?.name ?? "Jesus Film TV",
              scopes: record.scopes,
            })
          } catch (error) {
            if (error instanceof DeviceGrantError) {
              // Burn an attempt so a short code cannot be ground down by
              // repeated lookups, then answer without distinguishing "wrong" from
              // "expired" any more finely than the user needs.
              await recordUserCodeAttempt(prisma, {
                userCode: ctx.query.user_code,
              })
              logDeviceEvent("status_rejected", { outcome: error.code })
              throw toApiError(error)
            }
            throw error
          }
        },
      ),

      deviceGrantApprove: createAuthEndpoint(
        "/device/approve",
        {
          method: "POST",
          body: z.object({ user_code: z.string().min(1).max(32) }),
          requireHeaders: true,
        },
        async (ctx) => {
          assertEnabled()

          const session = await getSessionFromCtx(ctx)
          if (!session) {
            throw oauthError(
              "UNAUTHORIZED",
              "unauthorized",
              "Sign in to approve this device.",
            )
          }

          try {
            await approveDeviceCode(prisma, {
              userCode: ctx.body.user_code,
              userId: session.user.id,
              sessionId: session.session.id,
            })
          } catch (error) {
            if (error instanceof DeviceGrantError) {
              await recordUserCodeAttempt(prisma, {
                userCode: ctx.body.user_code,
              })
              logDeviceEvent("approve_rejected", {
                outcome: error.code,
                userId: session.user.id,
              })
              throw toApiError(error)
            }
            throw error
          }

          logDeviceEvent("approved", { userId: session.user.id })
          return ctx.json({ success: true })
        },
      ),

      deviceGrantDeny: createAuthEndpoint(
        "/device/deny",
        {
          method: "POST",
          body: z.object({ user_code: z.string().min(1).max(32) }),
          requireHeaders: true,
        },
        async (ctx) => {
          assertEnabled()

          const session = await getSessionFromCtx(ctx)
          if (!session) {
            throw oauthError(
              "UNAUTHORIZED",
              "unauthorized",
              "Sign in to respond to this request.",
            )
          }

          try {
            await denyDeviceCode(prisma, {
              userCode: ctx.body.user_code,
              userId: session.user.id,
            })
          } catch (error) {
            if (error instanceof DeviceGrantError) {
              await recordUserCodeAttempt(prisma, {
                userCode: ctx.body.user_code,
              })
              logDeviceEvent("deny_rejected", {
                outcome: error.code,
                userId: session.user.id,
              })
              throw toApiError(error)
            }
            throw error
          }

          logDeviceEvent("denied", { userId: session.user.id })
          return ctx.json({ success: true })
        },
      ),
    },
  }
}
