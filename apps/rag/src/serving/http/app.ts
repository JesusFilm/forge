import { randomUUID } from "node:crypto"
import { safeSearchFailure, SearchStageError } from "../../contracts/index.js"
import {
  createUsageReportRoutes,
  type UsageReportDeps,
} from "./usage-report.js"
import type { ServerResponse } from "node:http"
import type { UsageCollector } from "./usage.js"
import { searchRequestSchema, searchResponseSchema } from "@forge/rag-contracts"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"

import type { Retriever } from "../../contracts/index.js"
import { bearerToken, resolveScope } from "./auth.js"
import { createPortal, type PortalDeps } from "./portal.js"
import type {
  AuthenticatedConsumer,
  ConsumerAuthenticator,
} from "../../contracts/consumer-access.js"

const MAX_SEARCH_BODY_BYTES = 16 * 1024

export type AppDeps = {
  retriever: Retriever
  portal?: PortalDeps
  consumerAuth: ConsumerAuthenticator
  usage?: UsageCollector
  usageReport?: UsageReportDeps
}

export function createApp(deps: AppDeps): Hono<{
  Bindings: { outgoing?: ServerResponse }
  Variables: {
    authenticatedConsumer: AuthenticatedConsumer | null
    requestId: string
  }
}> {
  const app = new Hono<{
    Bindings: { outgoing?: ServerResponse }
    Variables: {
      authenticatedConsumer: AuthenticatedConsumer | null
      requestId: string
    }
  }>()

  app.onError((error, context) => {
    let bodyLimitError = false
    try {
      bodyLimitError = error.name === "BodyLimitError"
    } catch {
      /* Untrusted error accessors stay redacted. */
    }
    if (bodyLimitError) {
      return context.json({ error: "payload_too_large" }, 413)
    }
    const requestId = context.get("requestId") ?? randomUUID()
    context.header("x-rag-request-id", requestId)
    const failure = safeSearchFailure(error)
    console.error(
      `[rag] event=request_failed code=internal request_id=${requestId} stage=${failure.stage} category=${failure.category} detail=${failure.detail}`,
    )
    return context.json({ error: "internal" }, 500)
  })

  app.use("*", async (context, next) => {
    const requestId = randomUUID()
    context.set("requestId", requestId)
    context.header("x-rag-request-id", requestId)
    await next()
  })
  app.get("/v1/health", (context) => context.json({ status: "ok" }))
  if (deps.usageReport)
    app.route("/internal/usage", createUsageReportRoutes(deps.usageReport))
  if (deps.portal) app.route("/portal", createPortal(deps.portal))

  app.post(
    "/v1/search",
    bodyLimit({
      maxSize: MAX_SEARCH_BODY_BYTES,
      onError: (context) => {
        deps.usage?.denial("body_limit")
        return context.json({ error: "payload_too_large" }, 413)
      },
    }),
    async (context) => {
      const authorization = context.req.header("authorization")
      context.set("authenticatedConsumer", null)
      let consumer: AuthenticatedConsumer | null
      try {
        consumer = await deps.consumerAuth.authenticate(
          bearerToken(authorization) ?? "",
        )
      } catch {
        deps.usage?.denial("auth_unavailable")
        return context.json({ error: "auth_unavailable" }, 503)
      }
      if (!consumer) {
        deps.usage?.denial("unauthorized")
        return context.json({ error: "unauthorized" }, 401, {
          "WWW-Authenticate": "Bearer",
        })
      }

      context.set("authenticatedConsumer", consumer)
      await deps.usage?.admit(consumer.consumerId, context.env?.outgoing)
      const text = await context.req.text()

      let raw: unknown
      try {
        raw = JSON.parse(text)
      } catch {
        return context.json({ error: "invalid_json" }, 400)
      }

      const parsed = searchRequestSchema.safeParse(raw)
      if (!parsed.success) {
        return context.json(
          { error: "invalid_request", issues: parsed.error.issues },
          400,
        )
      }

      const { query, policy = {} } = parsed.data
      const allowedSourceKeys = resolveScope(
        consumer.allowedSourceKeys,
        policy.allowedSourceKeys,
      )
      if (allowedSourceKeys.length === 0) {
        return context.json({ results: [] })
      }

      const results = await deps.retriever.search(query, {
        ...policy,
        allowedSourceKeys,
      })
      try {
        return context.json(searchResponseSchema.parse({ results }))
      } catch (error) {
        throw new SearchStageError("response_contract", error)
      }
    },
  )

  return app
}
