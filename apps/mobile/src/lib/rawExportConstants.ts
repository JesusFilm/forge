/**
 * Dependency-free constants for the raw file export (save to Files). Every
 * later export module imports this leaf, so it holds no logic and no import.
 */

/**
 * R33's single build-time switch. False removes the mode control from both
 * sheets and refuses any new export; the launch sweep still runs, so a disable
 * never strands a staged file.
 */
export const RAW_EXPORT_ENABLED: boolean = true

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
 * Bound on the viewer-legible exported filename (R34), in UTF-16 code units.
 * The name derives from an untrusted video title, so it is sanitized and
 * truncated before it reaches the chosen folder. The internal staged name
 * keeps the same bound.
 */
export const RAW_EXPORT_MAX_FILENAME_LENGTH = 120

/**
 * The file system bound on the exported filename, in UTF-8 bytes (R23): APFS,
 * ext4 and F2FS each cap one name at 255 bytes. A title in a 3-byte script
 * reaches it before {@link RAW_EXPORT_MAX_FILENAME_LENGTH} does.
 */
export const RAW_EXPORT_MAX_FILENAME_BYTES = 255
