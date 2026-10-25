---
status: complete
priority: p2
issue_id: "030"
tags: [code-review, manager, security, elevenlabs, urls]
dependencies: []
---

# Harden ElevenLabs Source URL Handling

The new transcription-routing artifact persists full source URLs verbatim and the ElevenLabs path later fetches those URLs server-side, which creates both long-lived credential leakage and a broader outbound-fetch trust boundary than the rest of the manager flow uses.

## Problem Statement

This branch stores `sourceInputUrl` directly in job artifacts so reruns can reuse it later. If the URL contains signed query parameters or other credentials, those secrets become durable job metadata. Separately, the ElevenLabs path downloads that URL from the manager server, so a manager-authenticated caller can turn job creation into arbitrary outbound HTTPS fetches from the manager process.

The repo already has a host-only redaction pattern for materialization metadata, so the current routing artifact is drifting from an established safety boundary.

## Findings

- [`transcription-routing-report.ts`](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/transcription-routing-report.ts:136) stores `sourceInputUrl` verbatim in the routing report.
- [`jobs/route.ts`](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/route.ts:17) accepts any HTTPS `inputUrl`, and [`jobs/route.ts`](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/route.ts:108) persists it into `transcriptionRouting`.
- [`enrich/route.ts`](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/enrich/route.ts:318) also persists the full source URL into `transcriptionRouting`.
- [`elevenlabs-transcription.ts`](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/services/elevenlabs-transcription.ts:457) later downloads the source media directly from that stored URL.
- The repo already uses host-only redaction for materialization metadata in [`video-sources.ts`](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/video-sources.ts:59), but the new routing artifact does not follow that pattern.

## Proposed Solutions

### Option 1: Persist A Safe Source Reference, Not The Raw URL

**Approach:** Replace raw `sourceInputUrl` persistence with a safe durable reference, such as a redacted host/path summary plus a server-side lookup key or stored original-source record that reruns can resolve without exposing credentials to job readers.

**Pros:**

- Removes long-lived signed URL leakage from job artifacts.
- Keeps reruns possible without exposing secrets in operator-visible metadata.
- Aligns with the repo’s existing redaction pattern.

**Cons:**

- Requires designing a durable lookup/reference mechanism.
- Slightly broader scope than a simple field rename.

**Effort:** 4-8 hours

**Risk:** Medium

---

### Option 2: Restrict ElevenLabs Source Fetches To Trusted Hosts

**Approach:** Keep the current field temporarily, but validate that manager-side source fetches only target an allowlisted set of trusted media hosts and redact any persisted metadata.

**Pros:**

- Smaller change if a durable reference design is not ready yet.
- Reduces SSRF risk immediately.

**Cons:**

- Still relies on storing a raw URL unless paired with redaction.
- Less flexible for future ingestion sources.

**Effort:** 2-4 hours

**Risk:** Medium

## Recommended Action

Implemented a scoped version of Option 2. Routing metadata now redacts
credential-bearing URL parts before persistence, and manager-side ElevenLabs
downloads are limited to the trusted stage-clone media hosts already used by
the rest of the manager flow.

## Technical Details

**Affected files:**

- [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/transcription-routing-report.ts](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/transcription-routing-report.ts)
- [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/route.ts](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/jobs/route.ts)
- [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/enrich/route.ts](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/app/api/enrich/route.ts)
- [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/services/elevenlabs-transcription.ts](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/services/elevenlabs-transcription.ts)
- [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/video-sources.ts](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/video-sources.ts)

**Related components:**

- Job artifacts returned by manager APIs
- ElevenLabs rerun flow

**Database changes:**

- No migration required for a metadata-only fix, though a durable source-reference table or contract may broaden scope.

## Resources

- **Known pattern:** [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/video-sources.ts:59](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/video-sources.ts:59)
- **Routing artifact source URL storage:** [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/transcription-routing-report.ts:136](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/lib/transcription-routing-report.ts:136)
- **Manager-side fetch:** [/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/services/elevenlabs-transcription.ts:457](/Users/o/.codex/worktrees/f3a4/forge/apps/manager/src/services/elevenlabs-transcription.ts:457)

## Acceptance Criteria

- [x] Raw credential-bearing source URLs are no longer persisted in job artifacts.
- [x] Reruns still have a safe way to recover the original source media.
- [x] Manager-side ElevenLabs fetches are limited to trusted/expected source locations or an equivalent secure resolution path.
- [x] Tests cover URL redaction and trusted-source enforcement or equivalent source-reference resolution.

## Work Log

### 2026-04-12 - Review Finding

**By:** Codex

**Actions:**

- Reviewed how `sourceInputUrl` is created, persisted, and later reused by reruns.
- Compared the new routing artifact against the existing host-only redaction helper.
- Consolidated duplicate reviewer findings about long-lived URL storage and manager-side arbitrary fetch behavior into one source-handling issue.

**Learnings:**

- The current implementation solves rerun convenience by widening the trust boundary around source URLs.
- The safer repo pattern already exists; this branch just is not using it yet.

### 2026-04-12 - Fix + Validation

**By:** Codex

**Actions:**

- Updated `transcription-routing-report.ts` to strip username, password, query,
  and fragment components before persisting or reading `sourceInputUrl`.
- Reused the trusted stage-clone source-host allowlist in
  `video-sources.ts` and `elevenlabs-transcription.ts` so manager-side source
  downloads only run against expected MP4 origins.
- Added regression coverage for metadata redaction and untrusted-source
  rejection in `transcription-routing-report.test.ts` and
  `elevenlabs-transcription.test.ts`.
- Ran:
  - `pnpm --filter @forge/manager test -- src/lib/transcription-routing-report.test.ts src/services/elevenlabs-transcription.test.ts src/services/transcription.test.ts`
  - `pnpm --filter @forge/manager lint`
  - `pnpm --filter @forge/manager typecheck`

**Validation Evidence:**

- Routing metadata tests confirm credential-bearing URL components are removed
  before artifacts are written.
- ElevenLabs service tests confirm untrusted hosts are rejected before any
  outbound fetch occurs, while trusted stage-clone media URLs continue to be
  accepted.

**Learnings:**

- This fix intentionally narrows rerun/source reuse to trusted stage-clone media
  locations. If future ingestion sources need ElevenLabs reruns, they should
  come with an explicit secure source-resolution mechanism instead of widening
  the allowlist casually.
