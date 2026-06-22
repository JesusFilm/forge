/**
 * Validate a local `file://` media URI before handing it to the player or the
 * subtitle reader for offline playback. The streaming guards in
 * {@link ./validateUrl} deliberately block `file:` (they only allow Mux HTTPS),
 * so offline media needs its own narrow allow-path rather than loosening those.
 *
 * The predicate is pure and takes the allowed root explicitly (dependency
 * injection), so it is trivially unit-testable without the native filesystem.
 * Callers pass the app's offline-download root (derived from
 * `expo-file-system` `documentDirectory` at runtime). It accepts ONLY a local
 * `file:` URI whose fully-normalized path resolves to a location inside that
 * root — defeating `..`, percent-encoded `..`, sibling-prefix, UNC-host, and
 * null-byte tricks.
 */

/** Resolve `.`/`..` segments in a POSIX-style path. */
function resolveDotSegments(path: string): string {
  const isAbsolute = path.startsWith("/")
  const out: string[] = []
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") {
      out.pop()
      continue
    }
    out.push(segment)
  }
  return (isAbsolute ? "/" : "") + out.join("/")
}

/** True if the string contains a null byte or any C0 control character. */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) < 0x20) return true
  }
  return false
}

/**
 * Reduce a `file:` URI or a plain path to a normalized absolute path:
 * percent-decoded and with all dot segments resolved. Returns null if the
 * input is not a usable local path (wrong scheme, non-empty host, bad encoding,
 * or a null/control byte).
 */
function normalizeLocalPath(value: string): string | null {
  let rawPath: string

  if (value.startsWith("file:")) {
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      return null
    }
    // A local file has no authority component; `file://host/...` is a remote
    // UNC reference and must be rejected.
    if (parsed.host !== "") return null
    rawPath = parsed.pathname
  } else if (value.startsWith("/")) {
    rawPath = value
  } else {
    return null
  }

  let decoded: string
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    return null
  }
  // Reject null bytes and other control characters that could truncate or
  // confuse downstream filesystem calls.
  if (hasControlChar(decoded)) return null

  return resolveDotSegments(decoded)
}

/**
 * True only when `uri` is a local `file:` URI inside `allowedRoot`.
 *
 * @param uri         the candidate media/subtitle URI
 * @param allowedRoot the offline-download root (a `file://` URI or a plain
 *                    absolute path; trailing slash optional)
 */
export function validateLocalMediaUrl(
  uri: string | null | undefined,
  allowedRoot: string | null | undefined,
): boolean {
  if (!uri || !allowedRoot) return false
  if (!uri.startsWith("file:")) return false

  const path = normalizeLocalPath(uri)
  const root = normalizeLocalPath(allowedRoot)
  if (path == null || root == null) return false

  // Compare against a root that ends in exactly one separator so a sibling
  // directory sharing the prefix (".../downloads-evil") cannot match
  // (".../downloads/").
  const rootWithSlash = root.endsWith("/") ? root : `${root}/`
  return `${path}/`.startsWith(rootWithSlash)
}
