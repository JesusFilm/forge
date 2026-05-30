// WatchExperience fragment composing admin's per-block fragments.
//
// Re-exports the canonical fragment from `@forge/admin-graphql/fragments`
// under the local name `watchExperienceFragment` so consumers in this app
// continue to import it from `@/lib/fragments`.
//
// The shared package owns the fragment text because the same projection
// is needed by every web route that renders an ExperienceLocale (homepage,
// slug page, video-template path). Keeping it in the shared package keeps
// codegen, type isolation, and CI drift checks in one place.
import { adminWatchExperienceFragment } from "@forge/admin-graphql/fragments"

export const watchExperienceFragment = adminWatchExperienceFragment
