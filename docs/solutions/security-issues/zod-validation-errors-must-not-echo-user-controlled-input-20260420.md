---
title: "Zod validation errors must not echo user-controlled input to the caller"
category: "security-issues"
problem_type: "security_issue"
component: "service_object"
root_cause: "missing_validation"
resolution_type: "code_fix"
severity: "high"
module: "apps/admin"
tags:
  - security
  - zod
  - graphql
  - information-disclosure
  - path-traversal
  - error-masking
  - best-practice
date: "2026-04-20"
related_prs:
  - "JesusFilm/forge#798"
related_docs:
  - "docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md"
---

# Zod validation errors must not echo user-controlled input to the caller

Zod's default `.error.message` includes the values it rejected. When
the input is user-controlled AND the input is a filesystem/URL/resource
address, that makes the validator a content-read oracle. Surfaced
during the R1 review of `loadCoreIdMapping` in PR #798.

## Problem

`loadCoreIdMapping(path)` accepted an arbitrary filesystem path from an
ADMIN-authenticated GraphQL mutation argument, read the file, and
passed the contents through a Zod schema. On validation failure, the
service threw an error that included `validated.error.message` verbatim:

```typescript
throw new CoreIdMappingError(
  "mapping_invalid",
  `Core-ID mapping at ${path} failed schema validation: ${validated.error.message}`,
  validated.error,
)
```

Two primitives combine into a content-read oracle:

1. Unvalidated path → arbitrary file on disk readable by the service.
2. Zod error message echoed to the GraphQL client → the rejected field
   values leak back through the error response.

An ADMIN-session attacker can iterate through paths like
`/proc/self/environ`, service-account JSON keys, or any JSON file
containing secrets and read snippets of their contents back through
the mutation's error field.

## Symptoms

- GraphQL mutation responses surface detailed validation errors that
  quote the input file's contents (e.g., `expected string, received
"sk-live-..."`).
- Yoga's default `maskedErrors` is not a hard guarantee — dev /
  preview deploys surface full error text; a future Yoga upgrade
  could change the default.
- Any JSON file on the admin process's filesystem becomes
  content-readable via structured-error exfiltration, even when the
  server refuses to return the file verbatim.

## What Didn't Work

- **Relying on Yoga's `maskedErrors: true` default.** Masking is a
  defense-in-depth layer, not the contract — different environments
  mask differently, and the mitigation belongs at the service layer
  where the decision is explicit.
- **Truncating `validated.error.message`** before rethrowing — still
  leaks the first N characters of the rejected field.
- **Only logging the Zod error** — loses debuggability. The correct
  shape is to log full detail server-side AND throw a fixed
  client-facing message.

## Solution

### 1. Gate the input at the boundary

Reject any user-controlled filesystem path that doesn't resolve inside
a configured allowlist root. `realpath` resolution handles symlink
bypass.

```typescript
function getAllowedRoot(): string {
  const fromEnv = process.env.ADMIN_ARTIFACT_DIR
  return resolve(fromEnv ?? resolve(process.cwd(), ".tmp"))
}

async function assertPathWithinAllowedRoot(path: string): Promise<string> {
  if (!isAbsolute(path)) {
    throw new CoreIdMappingError(
      "mapping_path_rejected",
      `Path must be absolute, got ${JSON.stringify(path)}`,
    )
  }
  const root = getAllowedRoot()
  const resolved = await realpath(path)
  const rootWithSep = root.endsWith(sep) ? root : root + sep
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new CoreIdMappingError(
      "mapping_path_rejected",
      `Path must resolve inside ${root}`,
    )
  }
  return resolved
}
```

Note the error message mentions the allowed _root_ (operator-configured,
not user-controlled), never the rejected path. The attacker-supplied
string is quoted only in the "must be absolute" branch, which
discloses what they already know.

### 2. Fixed client-facing message + detailed server log

```typescript
const validated = CoreIdMappingFileSchema.safeParse(parsed)
if (!validated.success) {
  // Log server-side for debuggability.
  console.error(
    JSON.stringify({
      event: "core_id_mapping_invalid",
      path: resolvedPath,
      zodMessage: validated.error.message,
    }),
  )
  // Throw a fixed message — do NOT echo zod detail back to the caller.
  throw new CoreIdMappingError(
    "mapping_invalid",
    `Core-ID mapping failed schema validation`,
    validated.error,
  )
}
```

### 3. Keep the error-code taxonomy machine-useful

The typed `code` field lets callers branch cleanly (see
`docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md`)
without scraping the message. Adding `mapping_path_rejected` as a
distinct code keeps monitoring/alerting able to distinguish a
deliberately-rejected attack attempt from a legit missing-file.

## Why This Works

- **Path allowlist eliminates the arbitrary-file-read primitive.** Zod
  never gets a chance to validate contents it shouldn't have read.
- **Fixed error message removes the exfiltration channel.** Even if
  an attacker finds a readable JSON path inside the allowlist, the
  validation error no longer echoes file contents.
- **Server-side log preserves debuggability.** When an operator's
  real file fails validation, the detail is one `grep` away in
  Railway logs — not surfaced in an HTTP response.

## Prevention

- Any service that takes a user-controlled path, URL, or external
  resource identifier must validate / allowlist before opening the
  resource. Put the guard at the service entry, not inside the
  handler that opens the resource.
- Any service that runs Zod (or any schema validator) on
  user-reachable input must strip `validation.error.message` before
  surfacing the error. Log the detail server-side under a structured
  log event so the debugging path stays intact.
- Error classes exposed to GraphQL/HTTP surfaces must carry a typed
  `code` field; callers should branch on `code`, not on the message.
  This decouples the public contract from the private detail.
- Add an explicit test that reading a path outside the allowlist
  throws the dedicated `*_path_rejected` code. A test that just
  asserts "reading a missing file throws" does NOT cover this case.

## Prevention: tests

```typescript
it("rejects paths outside ADMIN_ARTIFACT_DIR with mapping_path_rejected", async () => {
  const outsideFixture = await writeFixture("valid.json", validPayload)
  process.env.ADMIN_ARTIFACT_DIR = "/somewhere/else/entirely"
  await expect(loadCoreIdMapping(outsideFixture)).rejects.toMatchObject({
    code: "mapping_path_rejected",
  })
})

it("rejects relative paths with mapping_path_rejected", async () => {
  await expect(loadCoreIdMapping("relative/path.json")).rejects.toMatchObject({
    code: "mapping_path_rejected",
  })
})

// Future: assert that mapping_invalid error message does NOT contain
// any value from the rejected file.
```

## Related

- `docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md`
  — typed-error classification is the companion pattern. Same
  instinct: the `code` field is the public surface; the message is
  operator-facing detail.
- `docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md`
  — R1 of admin migration; `loadCoreIdMapping` is the canonical call
  site for this pattern in the admin app.
- Related upstream concern — Yoga `maskedErrors` default: any service
  that depends on framework-level masking for security is building on
  sand. Prefer per-error masking at the service boundary.
