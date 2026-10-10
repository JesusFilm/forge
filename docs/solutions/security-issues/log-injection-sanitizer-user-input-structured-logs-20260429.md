---
title: "Log-injection: sanitize user input before interpolating into structured warn lines"
category: "security-issues"
problem_type: "security_issue"
component: "tooling"
root_cause: "missing_validation"
resolution_type: "code_fix"
severity: "low"
module: "apps/cms"
tags:
  - log-injection
  - structured-logging
  - input-sanitization
  - alerting
  - pino
date: "2026-04-29"
related_prs:
  - "JesusFilm/forge#feat-109"
---

## Problem

Structured-style log lines that interpolate raw user input
(`[search] event=… mode=${rawUserInput}`) are vulnerable to log
forgery: an attacker submitting `?mode=foo%0A[search]+event%3Dsearch_completed`
injects a CR/LF and forges a synthetic log entry. Downstream log
aggregation parsers split on newlines and treat the injected fragment
as a separate record. Result: alert reliability degrades — the
attacker can hide their own activity, impersonate other system
events, or DoS log-based alerts with crafted noise.

## Symptoms

- Log analysis tooling (Datadog, Loki, custom log parsers) shows
  unexpected `event=…` records that don't correspond to real code paths.
- Alert thresholds for `event=search_unknown_mode` either misfire or
  silently miss real incidents because the noise floor is artificially
  inflated.
- Incident response is slowed because forged entries look indistinguishable
  from real ones in the log stream.

## What Didn't Work

- Trusting the underlying logger (Pino, in Strapi v5) to escape control
  characters. Pino does JSON-encode string fields **when configured for
  structured output**, but in pretty-text mode (common in dev and
  Railway's default streaming console) raw newlines are emitted verbatim.
  Default config is the worst case to assume.
- Limiting query-string length at the WAF/proxy. Doesn't help — a 32-char
  injection (`foo%0Aevent=evil`) fits comfortably under any sane limit.

## Solution

Sanitize user-supplied values before interpolating them into log format
strings. Strip control characters and bound length:

```ts
export function normalizeMode(
  strapi: Core.Strapi,
  raw: string | null | undefined,
): RetrievalMode {
  if (raw == null || raw === "" || raw === "hybrid") return "hybrid"
  if (raw === "keyword-first") return "keyword-first"
  // Sanitize the user-supplied value before logging: strip control chars
  // (newlines, CRs, tabs) and truncate to a bounded length. Without this
  // an attacker could inject synthetic structured-log fields via
  // `?mode=foo%0A[search]+event%3D…` and forge log entries that confuse
  // alerts or hide their own activity.
  const sanitized = String(raw)
    .replace(/[\r\n\t]/g, " ")
    .slice(0, 64)
  strapi.log.warn(
    `[search] event=search_unknown_mode mode=${sanitized} falling_back=hybrid`,
  )
  return "hybrid"
}
```

For richer scenarios, prefer **structured logging APIs** that JSON-encode
fields automatically:

```ts
strapi.log.warn(
  { event: "search_unknown_mode", mode: raw, fallingBack: "hybrid" },
  "[search] unknown mode value",
)
// Pino encodes mode as a JSON string field; newlines become \n in the output.
```

## Why This Works

- `replace(/[\r\n\t]/g, " ")` collapses CR/LF/TAB to single spaces. After
  sanitization, the line cannot be split into multiple log records by a
  newline-based parser.
- `slice(0, 64)` bounds the worst-case attacker-controlled bytes per log
  line. Even if a future bug allows a control char through, the blast
  radius is capped.
- Structured logging APIs (Pino, Bunyan, Winston) JSON-encode field values,
  which neutralizes injection at the formatter level — no escaping logic
  in the call site.

## Prevention

1. **Code-review checklist for log lines.** Any `log.{warn,error,info}`
   call that interpolates a value sourced from `req.query`, `req.body`,
   `req.params`, or a GraphQL argument must either:
   - Use a structured logging API (object first, then format string), OR
   - Sanitize the value with the strip+truncate pattern above.
2. **Test for the regression.** Unit-test the log sanitizer:
   ```ts
   it("strips control chars from logged user input", () => {
     normalizeMode(strapi, "foo\r\nevent=injected")
     expect(logWarn).toHaveBeenCalledWith(
       expect.stringContaining("mode=foo  event=injected"), // newlines became spaces
     )
   })
   ```
3. **Audit existing log lines for the pattern.** Grep for backtick-string
   `log.{warn,error,info}` calls and triage which ones interpolate
   user-controlled data.
4. **Prefer structured logging long-term.** It's the right shape for
   alerting (filterable by field) AND it dodges the injection trap by
   construction.

## Related

- `apps/cms/src/api/search/services/search.ts` — `normalizeMode` with the
  sanitizer applied.
- The same pattern should be audited on any other `log.warn`/`log.error`
  call that interpolates query-string or GraphQL-arg values across the
  cms / admin / manager codebases.

## Admin-side counterpart

- `apps/admin/src/services/hybrid-search.service.ts` — `sanitizeForLog`
  - `normalizeMode` apply the same `replace(/[\r\n\t]/g, " ").slice(0, 64)`
    pattern at the warn call site for unknown `mode` values.
- `apps/admin/src/services/hybrid-search.regression.test.ts` — pins
  the sanitizer against `mode="garbage\r\nevent=injected"` (one log
  record, no synthetic event injection).
- `docs/solutions/platform/admin-hybrid-search-keyword-first-r4-extension-pattern.md`.
