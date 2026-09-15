/**
 * Shared ai-chat thread-title clamp (feat-405, KTD9). ONE home for the bound
 * every title choke point applies, so they cannot drift:
 *
 *   - the list projection in `ai-chat-history-route.ts` (`projectThreadRow`)
 *     clamps every title crossing the list wire — covering BOTH writers
 *     (per-turn titling and the title-repair sweep) plus the framework's own
 *     unclamped `createThread` path, and closing a pre-existing exposure: the
 *     chat proxy's 2 MiB list response cap has no derived budget, and 50
 *     unbounded titles is the one term that can breach it, failing the whole
 *     sidebar with a 502 rather than one row;
 *   - the title-repair sweep (`workflows/title-repair.ts`) clamps before its
 *     guarded UPDATE, refusing an empty-after-clamp result as a generation
 *     failure (that refusal is caller logic — this module only clamps);
 *   - the rename route (`ai-chat-history-write-route.ts`, feat-450) clamps a
 *     user-authored title before its guarded UPDATE and refuses 400
 *     `invalid_title` whenever the clamp returns `""`, whatever the raw input
 *     — an empty stored title would drop the thread back into the titling
 *     and repair path. The response echoes the clamped value so the client
 *     adopts exactly what was stored.
 *
 * Deliberately a leaf module (no imports) so either side can pull it in
 * without dragging the other's dependency graph.
 */

/**
 * Title display bound, in UTF-16 code units (the unit `String.length` and
 * `slice` count — a `slice` may split a surrogate pair, same accepted fidelity
 * loss as the replay path's display-string caps).
 */
export const AI_CHAT_TITLE_MAX_UNITS = 120

/**
 * Clamp a thread title for storage or the wire: strip control characters,
 * collapse whitespace runs to single spaces, trim, cap at
 * {@link AI_CHAT_TITLE_MAX_UNITS}. Total: `""` (the untitled wire sentinel)
 * passes through unchanged, and a clean short title is returned byte-identical.
 * Callers that must distinguish "empty because untitled" from "empty after
 * clamp" compare against their raw input.
 */
export function clampAiChatTitle(raw: string): string {
  const cleaned = raw
    // C0 controls + DEL + C1 controls, plus the invisible FORMAT characters
    // (soft hyphen, zero-width space/joiners + bidi marks, bidi embeddings
    // and overrides, word joiner + invisible operators, bidi isolates, BOM).
    // Without the format ranges an invisible-only model reply would clamp to
    // a non-empty "title" that renders blank yet escapes the sweep's
    // `title = ''` repair predicate forever (review finding, 2026-08-28).
    // Replaced with a space so an embedded "\n" keeps separating words; the
    // collapse below folds any runs. Accepted cost: a ZWJ-joined emoji
    // sequence in a title decomposes into its visible parts.
    .replace(
      // eslint-disable-next-line no-control-regex -- stripping control chars is the point
      /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff]/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim()
  return cleaned.length > AI_CHAT_TITLE_MAX_UNITS
    ? cleaned.slice(0, AI_CHAT_TITLE_MAX_UNITS)
    : cleaned
}
