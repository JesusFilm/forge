---
status: pending
priority: p2
issue_id: "018"
tags: [manager, ux, languages, search]
dependencies: []
---

# Fix Russian Discoverability In Language Picker

The coverage translation language picker currently makes primary Russian hard to find for English-speaking users.

## Problem Statement

During a real local QA enrich run on April 9, 2026, searching `Russian` in the coverage language picker did not surface the primary Russian language option. The picker only showed `Russian Sign Language`, while the actual Russian entry was only discoverable by searching `русский`.

This creates a confusing user experience and makes a common target language effectively undiscoverable unless the user already knows the native label.

## Findings

- Reproduced in the local manager UI during a real enrich flow before creating job `qswf5r6en45o56zku8tybje5`.
- [`LanguageGeoSelector.tsx`](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/features/coverage/LanguageGeoSelector.tsx) uses `matchesLanguageQuery(...)` at lines corresponding to the function near `86`, and it only compares normalized `englishLabel` and `nativeLabel`.
- The local language payload contains Russian entries:
  - `3934` with `englishLabel: "русский"` and `nativeLabel: "русский"`
  - `20899` with `englishLabel: "Русский"` and `nativeLabel: "Русский"`
- Searching `Russian` does not match either of those entries because neither label contains the English alias.
- The fallback remote search path in [`LanguageGeoSelector.tsx`](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/features/coverage/LanguageGeoSelector.tsx) requests `/api/languages?search=...`, but [`route.ts`](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/api/languages/route.ts) ignores the `search` query entirely and always returns the full cached payload.
- Because the route does not filter by `search`, the current "remote search" path is effectively a no-op for alias discovery and cannot recover when local matching fails.
- The only visible result for the English query `Russian` in the picker was `Russian Sign Language`, which has an English label and therefore matches the current search logic.

## Proposed Solutions

### Option 1: Add Search Aliases In Manager

**Approach:** Extend language search matching in manager to include additive aliases and transliterations for known languages, then use those aliases in both local matching and filtered remote results.

**Pros:**

- Fixes the actual picker behavior without requiring CMS schema changes.
- Can be implemented incrementally, starting with major languages like Russian.
- Keeps the UI responsive because matching still happens on the cached manager payload.

**Cons:**

- Introduces manager-owned alias data that must be maintained.
- Risks drifting from canonical language naming if not documented carefully.

**Effort:** 2-4 hours

**Risk:** Low

---

### Option 2: Normalize Searchable Labels In CMS Language Geo Data

**Approach:** Add searchable alias fields or normalized English exonyms in the CMS `language-geo` payload, then have manager search those fields.

**Pros:**

- Centralizes search semantics at the data source.
- Improves all consumers of the shared language payload, not just manager.

**Cons:**

- Requires CMS-side contract work and possible broader coordination.
- Bigger scope than the immediate manager UX defect.

**Effort:** 4-8 hours

**Risk:** Medium

---

### Option 3: Special-Case High-Traffic Language Aliases

**Approach:** Hard-code a small set of common alias fixes, such as mapping `Russian` to `русский`.

**Pros:**

- Fastest path to unblock the specific user-visible issue.
- Minimal code change.

**Cons:**

- Patchy and hard to scale.
- Leaves the broader search model inconsistent.

**Effort:** 1-2 hours

**Risk:** Medium

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**

- [/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/features/coverage/LanguageGeoSelector.tsx](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/features/coverage/LanguageGeoSelector.tsx)
- [/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/api/languages/route.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/api/languages/route.ts)

**Related components:**

- Coverage translation flow in [/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/features/coverage/coverage-report-client.tsx](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/features/coverage/coverage-report-client.tsx)
- Cached language geo payload from CMS `language-geo`

**Database changes:**

- No database migration expected for a manager-only fix.

## Resources

- **User-style local test job:** [qswf5r6en45o56zku8tybje5](http://localhost:3002/dashboard/jobs/qswf5r6en45o56zku8tybje5)
- **Relevant route:** [/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/api/languages/route.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/api/languages/route.ts)
- **Relevant picker component:** [/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/features/coverage/LanguageGeoSelector.tsx](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/features/coverage/LanguageGeoSelector.tsx)

## Acceptance Criteria

- [ ] Searching `Russian` in the coverage language picker surfaces the primary Russian language option.
- [ ] `Russian Sign Language` does not mask or replace the primary Russian result for that query.
- [ ] The fix works whether matching happens locally or through the picker's fallback search path.
- [ ] Existing searches by native labels such as `русский` continue to work.
- [ ] The selected Russian language can still be confirmed and used to launch an enrich job successfully.

## Work Log

### 2026-04-09 - Initial Discovery

**By:** Codex

**Actions:**

- Reproduced the issue during a real local browser QA run of the coverage translate flow.
- Verified that searching `Russian` only surfaced `Russian Sign Language`.
- Confirmed the primary Russian entries were only discoverable by searching `русский`.
- Reviewed the picker search logic and manager language route.
- Confirmed that `/api/languages?search=...` currently ignores the `search` query and always returns the full cached payload.

**Learnings:**

- This is both a data-label discoverability problem and a manager search-path drift problem.
- The current remote search fallback cannot fix alias mismatches because the API route does not actually filter by the supplied query.

## Notes

- The issue is not limited to Russian in principle; other languages with only native-script labels may be similarly hard to discover from English queries.
