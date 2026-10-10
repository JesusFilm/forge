---
title: "CodeQL js/insufficient-password-hash false positive on non-secret key-derived identifiers"
date: "2026-07-15"
category: tooling-decisions
module: apps/admin
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - "CodeQL js/insufficient-password-hash fires on a sha256/md5/fast-hash call whose input traces back to an env var or field named *_KEY, *_TOKEN, or *_SECRET"
  - "The hashed value is an already-high-entropy random API key/token (e.g. openssl rand -base64 32), not a low-entropy user-chosen password"
  - "The hash's purpose is a stable, non-secret, DETERMINISTIC identifier (rate-limit bucket key, log field, display label) rather than storing or verifying a credential"
  - "The repo runs CodeQL Default Setup with no .github/codeql/codeql-config.yml and no established inline-suppression convention, so the remediation path is dismiss-via-API/UI, not a config edit"
  - "Deciding whether to dismiss the alert vs. switch to a slow KDF (bcrypt/scrypt/argon2/PBKDF2), where switching would be WRONG because a KDF is salted/non-deterministic and cannot be used as a lookup/bucket key"
symptoms:
  - 'CI CodeQL check fails with 1 high-severity alert: rule js/insufficient-password-hash on a createHash("sha256").update(rawKey).digest("hex") call'
  - "The flagged sink derives a bucket key (e.g. fleet-global:<id>) and a log field from a fleet/partner API key, never stores or verifies a credential"
  - "An adjacent identical sha256-hashing function elsewhere in the codebase (e.g. hashRawToken in partner-token.ts) does NOT trip the rule, because its source variable isn't named *_KEY"
  - 'The fast-failing "CodeQL" PR check (~3s) is the code-scanning RESULTS gate, distinct from the slower "Analyze (javascript-typescript)" job, which passes'
tags:
  - codeql
  - false-positive
  - password-hash
  - sha256
  - hashing
  - security-scanner
  - rate-limiting
  - fleet-keys
related_components:
  - authentication
  - tooling
key_files:
  - "apps/admin/src/auth/fleet-key-id.ts"
  - "apps/admin/src/auth/partner-token.ts"
---

# CodeQL `js/insufficient-password-hash` is a false positive when sha256 derives a non-secret id from an already-high-entropy secret

## Context

CI CodeQL failed on PR #1577 (feat-240, admin fleet abuse ceiling) with one high-severity alert: rule `js/insufficient-password-hash` at `apps/admin/src/auth/fleet-key-id.ts:9`.

The flagged code derives a stable, **non-secret** bucket/log identifier from a fleet API key:

```ts
// apps/admin/src/auth/fleet-key-id.ts (the createHash line)
export function fleetKeyIdFromRawKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex").slice(0, 12)
}
```

That 12-hex-char id is consumed two ways, both non-secret:

- as a rate-limit bucket key `fleet-global:<id>` (in `apps/admin/src/auth/fleet-ceiling.ts`, `checkFleetGlobalCeiling`), so the global per-fleet-key search ceiling counts each fleet key separately; and
- as a structured log field `fleetKeyId=<id>` (the `.near` / `.degraded` / `.exceeded` log lines in `fleet-ceiling.ts`), so operators can tell fleet keys apart in logs without ever seeing the raw key.

It reaches the hash from an env-CSV value in `apps/admin/src/auth/search-bearer.ts` (the fleet branch of `isAnyKnownBearer`) — `fleetKeyId: fleetKeyIdFromRawKey(consumer.bucketKey)`, where `consumer.bucketKey` is a `FLEET_ADMIN_API_KEYS` / `WEB_ADMIN_API_KEYS` value.

CodeQL's `js/insufficient-password-hash` classifies any variable whose name matches the `*_API_KEYS` / password heuristic as a "password," then objects that sha256 has insufficient computational cost for password hashing (it wants bcrypt / scrypt / argon2 / PBKDF2). The trigger here is purely the **source variable name**, not what the value actually is.

## Guidance

Draw the line between two operations that both call a hash function but have opposite requirements:

1. **Hashing a credential FOR STORAGE / verification** (user passwords, anything you will later compare an untrusted guess against). The input is low-entropy and attacker-guessable, so you deliberately want a **slow, salted KDF** — bcrypt / scrypt / argon2 / PBKDF2 — to make offline brute force expensive. `js/insufficient-password-hash` is _correct_ to flag a bare sha256 here.

2. **Deriving a non-secret identifier FROM an already-high-entropy secret** (labeling, bucketing, logging). The input is a 256-bit random token, nothing is stored for later verification, and the output must be **deterministic and unsalted** so the same key always maps to the same bucket/label. Plain `sha256` (optionally truncated) is the _right_ primitive. This is what `fleetKeyIdFromRawKey` does.

When `js/insufficient-password-hash` flags case (2), it is a **false positive**. Do **not** "fix" it by switching to a slow KDF:

- A KDF is salted / non-deterministic, so you could no longer bucket or log on the output — the feature breaks.
- Slow hashing exists to defend _low-entropy_ passwords against brute force. A 256-bit random token (`openssl rand -base64 32`) has no brute-force surface to defend; the cost buys nothing.
- The 12-hex (48-bit) prefix is a collision-resistant label for a handful of keys (2–4 fleet keys), not a reversible mapping back to the key.

Instead, **dismiss the alert** with a documented justification. This repo uses CodeQL **default setup** — there is no `.github/codeql/codeql-config.yml` to add a query exclusion to, and no established inline-suppression (`// codeql[...]`) convention — so a per-alert dismissal via the code-scanning API is the standard resolution (the general mechanism + its remediation matrix live in the repo's canonical CodeQL-FP playbook — see Related).

Keep the SECURITY invariant that makes the dismissal honest: the **raw key must never appear in a bucket name or a log line** — only the derived `fleetKeyId`. That invariant is already asserted in the source comments of `fleet-key-id.ts` and `fleet-ceiling.ts`; preserve it if you touch this path.

## Why This Matters

Blindly "resolving" a security-scanner finding by rewriting the code to the tool's preferred primitive is a real regression risk. Here, obeying `js/insufficient-password-hash` and swapping `sha256` for bcrypt would:

- make the output non-deterministic (salt per call) → the same fleet key hashes to a different bucket every request → the global abuse ceiling can no longer aggregate per key → the feature the PR exists to ship silently stops working;
- add per-request KDF latency to the hot auth path for zero security gain.

Understanding _why_ the analyzer fired (a variable-name heuristic on `*_API_KEYS`, not an analysis of the value's entropy or lifecycle) is what lets you dismiss with confidence rather than either (a) shipping a broken "fix" or (b) leaving a red high-severity check that erodes trust in CI. The adjacent proof that the heuristic is name-driven: `apps/admin/src/auth/partner-token.ts:94` runs the identical `createHash("sha256").update(rawToken, "utf8").digest("hex")` and is **never** flagged — because its input variable is `rawToken`, not a `*_KEY`-named env var, so CodeQL's password-source heuristic never tags it.

## When to Apply

- A code-scanning alert (`js/insufficient-password-hash`, or any KDF-strength rule) fires on a `sha256` / `sha512` / `createHash` call whose input is a **randomly generated, high-entropy secret** (API token, session token, `randomBytes`-derived value) rather than a user-chosen password.
- The hash output is used as a **non-secret** identifier, bucket key, cache key, or log field — never stored to later verify an untrusted guess against.
- Determinism is a functional requirement (bucketing, dedupe, labeling), so a salted KDF is disqualified by design.
- Conversely, do the **opposite** — treat the alert as a true positive and switch to argon2/scrypt/bcrypt/PBKDF2 — when the hash guards a **password or other low-entropy secret at rest** that you later compare against.

## Examples

### Before → After (the resolution changes CI state, NOT the code)

**Before** — CI red, one high alert:

```
CodeQL: js/insufficient-password-hash — high
  apps/admin/src/auth/fleet-key-id.ts:9
  createHash("sha256").update(rawKey).digest("hex").slice(0, 12)
```

**Wrong "fix"** (do NOT do this): rewrite to a slow KDF.

```ts
// BREAKS the feature: salted + non-deterministic → bucket key changes every call
const id = await bcrypt.hash(rawKey, 12)
```

**Right resolution**: leave the code exactly as-is (it is correct), and dismiss the alert as a false positive. Find the alert number, then PATCH it:

```bash
# Look up the alert number for the rule (or read it from the PR check UI)
gh api repos/JesusFilm/forge/code-scanning/alerts \
  --jq '.[] | select(.rule.id=="js/insufficient-password-hash") | .number'
# → 71

# Dismiss it (this is the exact command used on #1577)
gh api -X PATCH repos/JesusFilm/forge/code-scanning/alerts/71 \
  -f state=dismissed \
  -f dismissed_reason='false positive' \
  -f dismissed_comment='fleetKeyIdFromRawKey derives a NON-SECRET deterministic id (sha256 prefix) from a 256-bit random fleet API key for rate-limit bucketing + logging. Never stored/verified as a credential; a slow KDF would break determinism. sha256 is correct here.'
```

GitHub then recomputes the PR's CodeQL check and it goes green.

Gotchas:

- `dismissed_reason` must be one of GitHub's fixed values: `false positive`, `won't fix`, or `used in tests`.
- **`dismissed_comment` has a 280-character limit** — exceeding it returns HTTP 422. Keep the justification tight (the example above is ~250 chars).
- Two distinct checks share the name "CodeQL": the **analysis job** `Analyze (javascript-typescript)` _passed_ (it just ran the queries), while the fast-failing (~3s) **results gate** check is what went red on the open alert. Dismissing the alert flips the results-gate check, not the analysis job.

### Contrast: the identical sha256 that is NOT flagged

```ts
// apps/admin/src/auth/partner-token.ts (hashRawToken) — same primitive, no alert
export function hashRawToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex")
}
```

This one stores `sha256(rawToken)` as the partner-key `keyHash` and is genuinely a token-at-rest hash — yet CodeQL stays silent because the input variable is `rawToken`, not a `*_KEY`-named env value. Same conclusion for the same reason: the token is a 256-bit `randomBytes(32)` value, so sha256 (no slow KDF, `timingSafeEqual` on decoded buffers for comparison) is the correct choice. The differing scanner behavior between two byte-identical hash calls is the clearest tell that this rule keys on the source variable name, not on the security properties of the operation.

## Related

- `docs/solutions/security-issues/ssrf-defense-streaming-proxy-and-codeql-fp-20260504.md` — the repo's **canonical CodeQL false-positive playbook** under GitHub Default Setup: the dismissal mechanism + full remediation matrix (Security-tab / `gh api` dismissal, data-extension pack, query-filter exclude) and the same `dismissed_reason` value + 280-char comment gotchas. This doc is the **rule-specific companion**: defer to that playbook for the general mechanism; here the focus is _why_ a sha256-of-high-entropy-key alert is specifically a false positive and why a KDF is the wrong "fix".
- `docs/solutions/security-issues/codeql-tainted-output-striphtml-console-error-20260414.md` — sibling CodeQL false-positive (a different rule); its meta-lesson ("don't contort the code to satisfy the analyzer's model") reinforces "dismiss, don't rewrite to a KDF".
- `docs/solutions/architecture-patterns/db-backed-vs-env-csv-credential-storage-20260518.md` — establishes `sha256(rawToken)` as this repo's deliberate standard for hashing API-key-shaped secrets (prior art the dismissal rationale rests on).
- `apps/admin/CLAUDE.md` → "Fleet-aware rate-limit bucketing" and "Partner API key store" — the two surfaces whose tokens are high-entropy random values hashed with sha256 for non-verification purposes.
- GitHub docs: [Dismissing code scanning alerts](https://docs.github.com/en/rest/code-scanning/code-scanning#update-a-code-scanning-alert) — `state`, `dismissed_reason` enum, `dismissed_comment` (max 280 chars).
