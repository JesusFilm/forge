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
import {
  bearerToken,
  lookupScope,
  resolveScope,
  type TokenRegistry,
} from "./auth.js"
import { createPortal, type PortalDeps } from "./portal.js"
import type {
  AuthenticatedConsumer,
  ConsumerAuthenticator,
} from "../../contracts/consumer-access.js"

const MAX_SEARCH_BODY_BYTES = 16 * 1024

export type AppDeps = {
  retriever: Retriever
  tokens: TokenRegistry
  portal?: PortalDeps
  consumerAuth?: ConsumerAuthenticator
  usage?: UsageCollector
  usageReport?: UsageReportDeps
}

export function createApp(deps: AppDeps): Hono<{
  Bindings: { outgoing?: ServerResponse }
  Variables: { authenticatedConsumer: AuthenticatedConsumer | null }
}> {
  const app = new Hono<{
    Bindings: { outgoing?: ServerResponse }
    Variables: { authenticatedConsumer: AuthenticatedConsumer | null }
  }>()

  app.onError((error, context) => {
    if (error.name === "BodyLimitError") {
      return context.json({ error: "payload_too_large" }, 413)
    }
    console.error(`[rag] event=request_failed code=internal`)
    return context.json({ error: "internal" }, 500)
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
      let scope = null as ReturnType<typeof lookupScope>
      context.set("authenticatedConsumer", null)
      if (deps.consumerAuth) {
        const presented = bearerToken(authorization)
        if (presented?.startsWith("rag_")) {
          try {
            const consumer = await deps.consumerAuth.authenticate(presented)
            if (consumer) {
              context.set("authenticatedConsumer", consumer)
              scope = { allowedSourceKeys: consumer.allowedSourceKeys }
            }
          } catch {
            deps.usage?.denial("auth_unavailable")
            return context.json({ error: "auth_unavailable" }, 503)
          }
        } else {
          scope = lookupScope(deps.tokens, authorization)
        }
      } else {
        scope = lookupScope(deps.tokens, authorization)
      }
      if (!scope) {
        deps.usage?.denial("unauthorized")
        return context.json({ error: "unauthorized" }, 401, {
          "WWW-Authenticate": "Bearer",
        })
      }

      const consumer = context.get("authenticatedConsumer")
      if (consumer)
        await deps.usage?.admit(consumer.consumerId, context.env?.outgoing)
      else deps.usage?.denial("legacy_unattributed")
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
      const allowedSourceKeys = resolveScope(scope, policy.allowedSourceKeys)
      if (allowedSourceKeys?.length === 0) {
        return context.json({ results: [] })
      }

      const results = await deps.retriever.search(query, {
        ...policy,
        allowedSourceKeys,
      })
      return context.json(searchResponseSchema.parse({ results }))
    },
  )

  return app
}
