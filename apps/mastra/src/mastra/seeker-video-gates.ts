/**
 * Shape gates for the seeker's video capability (feat-327, plan D9).
 *
 * ONE home for the patterns, imported by BOTH boundaries that apply them:
 *
 *   - `mastra/tools/seeker-search-videos.ts` — drops non-conforming rows at the
 *     TOOL boundary so the model is never shown a candidate it could declare
 *     but the route could never attach.
 *   - `mastra/agents/seeker-turn-projection.ts` — re-applies them in
 *     `projectVideo` on the DECLARED row, over an `unknown` payload (D9
 *     belt-and-braces). Since feat-329 that module serves BOTH the live send
 *     path and the replay path, so a stored row is re-gated on every replay.
 *
 * Sharing the CONSTANTS is not the same as skipping the second check. D9's
 * belt-and-braces is about re-validating the untrusted DATA at the wire
 * boundary, not about re-deriving the regex — two hand-copied patterns would
 * only add a silent drift surface where the tool admits what the route rejects
 * (exactly the gap this module was created to close).
 *
 * Direction of dependency is deliberate: both consumers import from HERE, and
 * neither imports from the other. `seeker-turn-projection.ts` already imports
 * tool-NAME constants from the two tool modules, so a tool importing back from
 * that module would close a cycle.
 *
 * WHY THESE PATTERNS (do not loosen without re-reading this):
 *
 * `SLUG_PATTERN` is security-load-bearing AND link-integrity-bearing. It is the
 * sole control over what path the caption link interpolates into on
 * jesusfilm.org, because `buildCanonicalWatchVideoPath` performs raw template
 * interpolation; it excludes every URL metacharacter (`/ ? # %`) and all
 * whitespace. It is case-SENSITIVE lowercase-only because the URL builder
 * compares `languageSlug === "english"` exactly, so an odd-cased value must fail
 * closed rather than slip past the default-language branch.
 *
 * PRODUCTION EVIDENCE (2026-08-04, live-site census): all 1,154 distinct
 * content slugs across the public watch sitemap (10 parts, 31,402 URLs) conform
 * to this pattern — zero non-ASCII slugs are published. The two non-conforming
 * slugs observed on admin's agent-tools wire (`la-búsqueda-the-search`,
 * `tümlükden-nura`) have NO published watch page: both 404 in accented and
 * ASCII-folded URL shapes and appear in no sitemap. So widening the pattern to
 * admit them would have shipped a working player beside a DEAD caption link.
 * The gate was accidentally protecting link integrity; that is now deliberate.
 *
 * Residual, stated honestly: slug SHAPE is not page LIVENESS. An ASCII-slugged
 * unpublished row passes every gate here and would still ship a dead caption
 * link. That is a catalog-hygiene question, raised with the Core-sync owner
 * separately — not something these patterns can answer.
 */

/** Mux playback id, interpolated into stream.mux.com / image.mux.com URLs. */
export const PLAYBACK_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/

/** Video + language slug. See the security/link-integrity note above. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,80}$/

/**
 * `videoId` is not interpolated into a URL, but it IS the one string the model
 * supplies, so it gets a bound rather than being the single unvalidated hole in
 * a field-by-field allowlist. Admin ids are cuid-shaped (measured 2026-08-04:
 * 0/132 sampled rows failed), so this rejects nothing legitimate.
 */
export const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** The one availability kind eligible for featuring in v1 (plan D5). */
export const FEATURABLE_AVAILABILITY_KIND = "target_audio"
