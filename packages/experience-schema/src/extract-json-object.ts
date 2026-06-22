/**
 * Recover a JSON object substring from an LLM text reply.
 *
 * Chat models routinely wrap structured output in prose and/or markdown
 * code fences ("Here's the draft:\n```json\n{...}\n```\nLet me know…")
 * even when the prompt says JSON-only. This helper:
 *
 *  1. Strips ALL markdown code fences (global) — multi-fence replies are
 *     common when a model "shows its work" then emits the final object.
 *  2. Scans for top-level balanced `{...}` spans (brace-depth aware, so a
 *     `{` inside earlier prose like "use the {placeholder} token" doesn't
 *     swallow the real envelope) and returns the LAST span that
 *     successfully `JSON.parse`s.
 *
 * Returning the LAST parseable balanced span (rather than first-`{` to
 * last-`}`) is the key correctness property: prose that contains braces
 * before the real envelope no longer corrupts extraction, and a trailing
 * "Let me know…" after the object is naturally excluded.
 *
 * Returns the matched substring (NOT the parsed value) so callers keep
 * ownership of the parse + any jsonrepair fallback ladder. Returns null
 * when no balanced object is present.
 *
 * Shared by `experience-ai-chat.service.ts` (chat turn) and
 * `mastra/workflows/multi-step-draft-workflow.ts` (draft workflow) so the
 * two paths tolerate identical envelope shapes — keep this the single
 * source of truth.
 */
export function extractJsonObject(text: string): string | null {
  // Drop every markdown fence marker (opening ```json / ``` and closing
  // ```), globally — not just the first/last. The brace scanner below
  // then operates on the de-fenced text.
  const fenceStripped = text
    .replace(/```(?:json|JSON)?[ \t]*\r?\n?/g, "")
    .replace(/\r?\n?[ \t]*```/g, "")

  const spans = collectBalancedObjectSpans(fenceStripped)
  // Prefer the LAST balanced span that parses — the real envelope is
  // (almost) always the final object, after any planning prose.
  for (let i = spans.length - 1; i >= 0; i -= 1) {
    const candidate = spans[i]
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      // Not valid JSON on its own — keep walking earlier spans. The
      // caller's jsonrepair ladder handles near-valid-but-not-quite spans
      // when none parse cleanly (see the fallback below).
    }
  }

  // No span parsed cleanly. Fall back to the LAST balanced span (if any)
  // so the caller's jsonrepair ladder gets a structurally-bounded object
  // to repair rather than the whole prose blob.
  return spans.length > 0 ? spans[spans.length - 1] : null
}

/**
 * Collect every TOP-LEVEL balanced `{...}` substring, string-aware so
 * braces inside JSON string literals don't perturb the depth count.
 */
function collectBalancedObjectSpans(text: string): string[] {
  const spans: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === "\\") {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === "{") {
      if (depth === 0) start = i
      depth += 1
    } else if (ch === "}") {
      if (depth > 0) {
        depth -= 1
        if (depth === 0 && start !== -1) {
          spans.push(text.slice(start, i + 1))
          start = -1
        }
      }
    }
  }

  return spans
}
