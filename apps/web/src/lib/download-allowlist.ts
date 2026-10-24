/**
 * U9 — Download URL origin allowlist.
 *
 * Validates a candidate download URL before triggering the browser download
 * mechanism (`<a download href={url}>`). This prevents the watch page from
 * being weaponized as a redirector for arbitrary URLs surfaced through CMS
 * content, and enforces that downloads use HTTPS.
 *
 * Allowed origins (per the watch-page parity plan, Key Decisions →
 * "Download URL origin allowlist"):
 *   - `jesusfilm.org` and any subdomain (`*.jesusfilm.org`)
 *   - `stream.mux.com` and any subdomain (`*.mux.com`)
 *
 * Empirical observation from the U2 spike: download URLs come from BOTH
 * `stream.mux.com` AND `api-media-core.jesusfilm.org`; both must remain
 * allowed (the latter matches via the `.jesusfilm.org` suffix rule).
 *
 * **Limitation:** validates the **initial URL only**. Does NOT follow
 * redirect chains. The editorial control documented in the plan is that
 * `VideoVariantDownload.url` values must point directly to the CDN asset,
 * not to a redirect intermediary. Hardening to follow redirects is tracked
 * as a follow-up if redirect intermediaries become common.
 */

/**
 * Returns `true` when the URL is HTTPS and its hostname matches the
 * download-source allowlist; otherwise `false`.
 *
 * Returns `false` for malformed URLs, non-HTTPS protocols (including
 * `http:`, `javascript:`, `data:`, `file:`), and protocol-relative URLs
 * (`//host/path`) — `new URL()` requires an absolute URL when called with
 * a single argument and throws otherwise; the throw is caught here.
 */
// Shared allowlist of media file extensions the download proxy may serve
// AND the client may stamp on the saved file's name. Keep these in sync —
// a server-allowed extension that isn't in this set will be silently
// renamed to `.mp4` by the client (e.g., a .wav download would land as
// `<slug>-highest.mp4`).
export {
  SAFE_DOWNLOAD_EXTENSIONS,
  isAllowedDownloadOrigin,
} from "@forge/watch-url-policy/download"
