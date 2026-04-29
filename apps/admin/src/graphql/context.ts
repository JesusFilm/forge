// Per-request GraphQL context builder.
//
// Unit 5 resolves the Better Auth session from request cookies, then maps
// the DB-backed user role into the GraphQL principal. `SYSTEM` remains an
// in-process-only principal; HTTP requests can never mint it.
//
// Plan 006 adds a service-to-service `Authorization: Bearer <key>` path
// that mints the request-bound `WORKFLOW_TRIGGER` principal when the
// header matches `WORKFLOW_API_KEYS`. The Better Auth session path
// continues to take precedence — a logged-in admin's session is never
// downgraded by the presence of a bearer header.
//
// Per Unit 3 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import { prisma } from "@/db/client"
import { resolvePrincipalFromRequest } from "@/auth/session"
import { WORKFLOW_TRIGGER_PRINCIPAL } from "@/auth/principal"
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
  // demoted to the narrower workflow-trigger principal.
  const user =
    sessionUser ??
    (isValidWorkflowBearer(request.headers.get("authorization"))
      ? WORKFLOW_TRIGGER_PRINCIPAL
      : null)
  return {
    user,
    request,
    prisma,
    loaders: createLoaders(prisma),
    services: createServices(prisma),
  }
}
