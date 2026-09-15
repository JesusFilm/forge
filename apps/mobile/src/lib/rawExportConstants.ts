/**
 * Dependency-free constants for the raw file export (save to Photos). Every
 * later export module imports this leaf, so it holds no logic and no import.
 */

/**
 * R33's single build-time switch. False removes the mode control from both
 * sheets and refuses any new export; the launch sweep still runs, so a disable
 * never strands a staged file.
 */
export const RAW_EXPORT_ENABLED: boolean = true

/**
 * Android album for saved videos. KD7 fixes the name before the first build
 * ships, because the app can neither rename nor delete an album it created.
 */
export const RAW_EXPORT_ALBUM_NAME = "Jesus Film Watch"

/**
 * KTD2's transfer-id namespace. It must stay disjoint from the offline ids,
 * which are bare video slugs, because the offline delete path removes a whole
 * per-video directory keyed by slug.
 */
export const RAW_EXPORT_ID_PREFIX = "rawexport:"

/**
 * Name of the staging directory. U9 composes the root as a SIBLING of
 * OFFLINE_ROOT, never inside it, because the offline root is also the player's
 * trust prefix.
 */
export const RAW_EXPORT_DIR_NAME = "raw-exports"

/**
 * Bound on the viewer-legible exported filename (R34). The name derives from an
 * untrusted video title, so it is sanitized and truncated before it reaches the
 * device library.
 */
export const RAW_EXPORT_MAX_FILENAME_LENGTH = 120
