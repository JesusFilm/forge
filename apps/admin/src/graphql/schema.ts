// GraphQL schema assembled from all type modules. Import types for their
// side effects (each registers on the shared builder).
//
// Per Unit 4 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import { builder } from "@/graphql/builder"
// Order matters: reference types first (they define the JSON scalar used by
// Experience), then asset/content types, then mutations.
import "@/graphql/types/reference"
import "@/graphql/types/mediaAsset"
import "@/graphql/types/mediaFolder"
import "@/graphql/types/video"
import "@/graphql/types/videoScene"
import "@/graphql/types/videoTranscript"
import "@/graphql/types/managerSession"
import "@/graphql/types/managerReadModels"
import "@/graphql/types/managerJob"
import "@/graphql/types/watch-events"
// Block union types must register before experience.ts since
// ExperienceLocale.blocks consumes the ExperienceBlock union.
import "@/graphql/types/blocks"
import "@/graphql/types/experience"
import "@/graphql/mutations/media-asset"
import "@/graphql/mutations/media-folder"
import "@/graphql/mutations/experience"
import "@/graphql/mutations/transcript-embedding"
import "@/graphql/mutations/experience-embedding-backfill"
import "@/graphql/mutations/manager-enrichment"
import "@/graphql/queries/search"
// Debug-payload types must register before the hybrid-search query
// references them via SearchResultDebugRef.
import "@/graphql/types/hybrid-search-debug"
import "@/graphql/queries/hybrid-search"
import "@/graphql/queries/scene-recommendations"
import "@/graphql/queries/sync-status"
// Must register after Experience (depends on ExperienceLocale).
import "@/graphql/types/watch-setting"

export const schema = builder.toSchema()
