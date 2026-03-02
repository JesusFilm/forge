/**
 * Re-export watch experience operation and types from the shared GraphQL package.
 * Expo consumes generated clients only; the operation is defined in @forge/graphql.
 */
export {
  GET_WATCH_EXPERIENCE,
  type WatchExperience,
  type WatchExperienceQueryResult,
  type WatchExperienceQueryVariables,
  type WatchExperienceSection,
} from "@forge/graphql"
