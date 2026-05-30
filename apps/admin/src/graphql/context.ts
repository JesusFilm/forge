// Per-request GraphQL context builder.
//
// Unit 5 resolves the admin-local OAuth session from request cookies, then
// maps the DB-backed user role into the GraphQL principal. `SYSTEM` remains
// an in-process-only principal; HTTP requests can never mint it.
//
// Plan 006 adds a service-to-service `Authorization: Bearer <key>` path
// that mints the request-bound `WORKFLOW_TRIGGER` principal when the
// header matches `WORKFLOW_API_KEYS`. The admin session path continues to take
// precedence — a logged-in admin's session is never
// downgraded by the presence of a bearer header.
//
// Plan 003 (U1) adds a second bearer path that mints `CONSUMER_BEARER`
// when the header matches `WEB_ADMIN_API_KEYS`. Used by apps/web SSR
// for rate-limit bucketing — the principal carries NO permissions
// beyond PUBLIC. Same session-wins precedence applies: an editor with
// a session cookie who also forwards a consumer-app bearer keeps their
// editorial role. The bearer-resolution chain is:
//   session → workflow-bearer → consumer-bearer → PUBLIC
// in that order; the first match wins. Workflow-bearer goes before
// consumer-bearer so a deployment that mistakenly puts the same key in
// both CSVs doesn't silently downgrade a workflow caller to the
// permissionless consumer bucket — the workflow path retains its
// narrow allowlist semantics.
//
// SECURITY: this module MUST NEVER log raw `Authorization` header
// values or bearer key strings. Log scrubbing is unit-tested via
// console spies in `context.test.ts`.
//
// Per Unit 3 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import { prisma } from "@/db/client"
import { resolvePrincipalFromRequest } from "@/auth/session"
import {
  CONSUMER_BEARER_PRINCIPAL,
  MANAGER_BACKEND_PRINCIPAL,
  WORKFLOW_TRIGGER_PRINCIPAL,
} from "@/auth/principal"
import { isValidConsumerBearer } from "@/auth/consumer-bearer"
import { isValidManagerBearer } from "@/auth/manager-bearer"
import { isValidWorkflowBearer } from "@/auth/workflow-bearer"
import type { ContextShape } from "@/graphql/builder"
import { createLoaders } from "@/graphql/loaders"
import { createServices } from "@/services"

export async function createContext({
  request,
}: {
  request: Request
}): Promise<ContextShape> {
  const sessionUser = await resolvePrincipalFromRequest(request)
  // Session wins. A user with an admin session who happens to also send
  // a (valid or stray) bearer header is treated as that session, not
  // demoted to a narrower bearer principal. Otherwise the chain is
  // workflow → consumer → PUBLIC. The two bearer CSVs
  // (`WORKFLOW_API_KEYS`, `WEB_ADMIN_API_KEYS`) are contractually
  // disjoint per `permissions.test.ts`; precedence here is the safety
  // net if that invariant ever drifts (workflow's narrow allowlist wins
  // over consumer's permissionless bucket).
  let user = sessionUser
  if (user == null) {
    const authHeader = request.headers.get("authorization")
    if (isValidWorkflowBearer(authHeader)) {
      user = WORKFLOW_TRIGGER_PRINCIPAL
    } else if (isValidManagerBearer(authHeader)) {
      user = MANAGER_BACKEND_PRINCIPAL
    } else {
      const consumer = isValidConsumerBearer(authHeader)
      if (consumer.valid) {
        user = CONSUMER_BEARER_PRINCIPAL({
          rateLimitBucketKey: consumer.bucketKey,
        })
      } else {
        user = null
      }
    }
  }
  return {
    user,
    request,
    prisma,
    loaders: createLoaders(prisma),
    services: createServices(prisma),
  }
}
