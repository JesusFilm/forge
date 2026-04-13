// GraphQL schema assembled from all type modules. Import types for their
// side effects (each registers on the shared builder).
//
// Per Unit 3 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import { builder } from "@/graphql/builder"
import "@/graphql/types/ping"

export const schema = builder.toSchema()
