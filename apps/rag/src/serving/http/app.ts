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
}

export function createApp(deps: AppDeps): Hono<{
  Variables: { authenticatedConsumer: AuthenticatedConsumer | null }
}> {
  const app = new Hono<{
    Variables: { authenticatedConsumer: AuthenticatedConsumer | null }
  }>()

  app.onError((error, context) => {
    if (error.name === "BodyLimitError") {
      return context.json({ error: "payload_too_large" }, 413)
    }
    console.error(`[rag] event=request_failed error_name=${error.name}`)
    return context.json({ error: "internal" }, 500)
  })

  app.get("/v1/health", (context) => context.json({ status: "ok" }))
  if (deps.portal) app.route("/portal", createPortal(deps.portal))

  app.post(
    "/v1/search",
    bodyLimit({
      maxSize: MAX_SEARCH_BODY_BYTES,
      onError: (context) => context.json({ error: "payload_too_large" }, 413),
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
            return context.json({ error: "auth_unavailable" }, 503)
          }
        } else {
          scope = lookupScope(deps.tokens, authorization)
        }
      } else {
        scope = lookupScope(deps.tokens, authorization)
      }
      if (!scope) {
        return context.json({ error: "unauthorized" }, 401, {
          "WWW-Authenticate": "Bearer",
        })
      }

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
