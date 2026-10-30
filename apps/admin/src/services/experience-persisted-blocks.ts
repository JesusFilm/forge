// Read-side compatibility for Experience block JSON saved by older versions.
//
// Commit 709c84a56 moved authored block visuals onto asset ids and removed the
// raw `imageUrl` / `backgroundImageUrl` fields from the strict `BlocksSchema`,
// along with its transitional normalizer. Rows and revisions written before
// that change can still carry the retired keys. Persisted data is cleaned here,
// in the service layer, so reads and duplication work while `BlocksSchema`
// keeps rejecting raw image URLs in new API, editor, and MCP input.

const RETIRED_BLOCK_VISUAL_URL_KEYS: ReadonlySet<string> = new Set([
  "imageUrl",
  "backgroundImageUrl",
])

/**
 * Returns a copy of saved block JSON without the retired visual URL keys, at
 * any depth. Every other key (including the live `mediaUrl`) is left as-is, no
 * schema defaults are applied, and the input is never mutated. Call it only on
 * data read back from storage, never on new input.
 */
export function stripRetiredBlockVisualUrls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripRetiredBlockVisualUrls(item))
  }
  if (value === null || typeof value !== "object") return value

  const cleaned: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    if (RETIRED_BLOCK_VISUAL_URL_KEYS.has(key)) continue
    cleaned[key] = stripRetiredBlockVisualUrls(nested)
  }
  return cleaned
}
