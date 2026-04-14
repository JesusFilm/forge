// GraphQL schema assembled from all type modules. Import types for their
// side effects (each registers on the shared builder).
//
// Per Unit 4 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import { builder } from "@/graphql/builder"
// Order matters: reference types first (they define the JSON scalar used by
// Experience), then Video, then Experience.
import "@/graphql/types/reference"
import "@/graphql/types/video"
import "@/graphql/types/experience"
import "@/graphql/mutations/experience"

export const schema = builder.toSchema()
