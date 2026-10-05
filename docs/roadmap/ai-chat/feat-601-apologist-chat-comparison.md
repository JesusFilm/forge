---
id: "feat-601"
title: "Temporary Apologist comparison in Forge Chat"
owner: "jian wei"
priority: "P2"
status: "complete"
start_date: "2026-09-24"
duration: 3
depends_on: []
blocks:
  - "feat-602"
tags:
  - ai-chat
  - prototype
  - apologist
---

## Resolution

**Shipped:** 2026-10-02 via [PR #2548](https://github.com/JesusFilm/forge/pull/2548) (`feat(chat): add temporary Apologist answer comparison`). Production enablement and verification were confirmed by the operator on 2026-10-05.

**What landed.** A temporary, separately allowlisted comparison sends a shared question to Forge and Apologist, with independent responses and fixed provider headings. Forge history persists; Apologist history is temporary. The comparison is disabled by default in code and is now enabled in production for the configured internal testers.

**Production verification (operator-confirmed).** The operator confirmed these checks in the deployed browser; this closeout records their results rather than a new agent-run verification:

- A shared question and follow-up reached terminal answers on both sides.
- Apologist response metadata identified the production prompt, without a fallback notice.
- Refresh restored only the Forge/Seeker conversation and discarded the Apologist transcript.
- Stop cancelled an in-progress answer.
- A signed-in user outside the comparison allowlist could not access the comparison.
- Setting `APOLOGIST_COMPARE_ENABLED=false` rejected a new request from an already-open comparison, closed the comparison, and displayed the access-changed notice. Refresh removed the comparison entry button.
- Re-enabling the switch restored working comparison access.

Implementation and local browser/performance verification were completed before merge. Production enablement checks under U6 are now complete. No credentials or one-off verification artifacts are recorded here.

**Follow-ups.** [Operations](../../operations/apologist-comparison.md) defines configuration and rollback. [feat-602](feat-602-remove-apologist-comparison.md) remains open for removal before public release; its implementation dependency is satisfied, but the removal trigger is unchanged. Core's model update remains separately tracked in NES-1895 below.

### Accepted model difference

This comparison uses Core's Apologist integration and production prompt, with
`openai/gpt/4o-mini` intentionally selected instead of Core's operator-reported
`google/gemini/3-flash`. It does not reproduce Core's exact model configuration.
The operator confirmed the same gateway URL/key and the intended prompt project
and version. Whether Core's model ID remains supported is tracked by [NES-1895](https://linear.app/jesus-film-project/issue/NES-1895/update-production-apologist-model-id-before-the-christmas-campaign), not a blocker for this temporary comparison.

## Problem

The following brief records the pre-implementation requirements; production enablement is complete as recorded in the resolution above.

Internal testers need to ask Forge's Seeker agent and Core's Apologist integration the same questions for informal testing and demonstrations.
The comparison is temporary and must be removable before public release.
Implementation is ready for the normal code-PR flow; production enablement remains outstanding.
Removal is tracked by feat-602; production enablement remains gated on U6 evidence.
Owner and duration are provisional, following the existing lane assignment.

## Entry Points — Read These First

1. `docs/plans/2026-09-24-0426-feat-apologist-chat-comparison-plan.md` — confirmed requirements, implementation units, prerequisites, verification, and removal boundary.
2. `apps/chat/CLAUDE.md` — canonical chat architecture and temporary comparison boundary.
3. `apps/chat/src/components/shell/app-shell.tsx` — conversation owner and navigation wiring.
4. `apps/chat/src/lib/conversation-session.ts` — existing sends, persistence, and cancellation.
5. `apps/chat/src/lib/seeker-gate.ts` — verified-email gate to compose with the new comparison gate.
6. Core's `apps/journeys/pages/api/chat/index.ts` and `apps/journeys/src/libs/langfuse/client.ts` — Apologist provider and World Cup prompt configuration.

## Grep These

`resolveSeekerGate`, `createConversationSession`, `serverPersisted`, `useConversationUrl`, `onSelectFollowUp`, `APOLOGIST_API_URL`, `apologist-world-cup-chat`.

## What To Build

Follow the linked plan's R1–R16 and U1–U6.
Add a comparison-only controller/view, an authenticated `/api/apologist` route, and an isolated server adapter.
Reuse the existing Forge session and history behavior.
Only eligible users on empty conversations can enter comparison; one composer addresses both providers.
Reject a question over Core's 4,000-character text-field limit before sending to either provider; keep ordinary Forge's limit unchanged. Recommend New conversation only for accumulated Apologist history limits.
Create the removal ticket in the implementation PR, once the code shape is known. Link it here and record its trigger, searches, keep-list, verification, and operator cleanup.

## Constraints

- No scoring, export, transcript-copy feature, public comparison release, separate app, database migration, or cross-app imports.
- Preserve Core's Apologist prompt and response settings with the accepted model difference above; verify the approved configuration in Forge production before enablement.
- Keep the additional switch off until credentials, production prompt access, and a controlled integration smoke are verified.
- Keep secrets server-side and out of repository evidence.
- Production deployment follows the normal PR-to-main path.

## Verification

The linked plan defines gate, stream, lifecycle, UI, and performance checks.
Run chat lint, typecheck, tests, production build, formatting, and the repository's affected CI checks during implementation.
Verify a saved Forge thread reopens alone after refresh and that Apologist history cannot be resumed.
Verify that an oversized comparison question reaches neither provider and leaves the draft intact, while an accumulated-history failure points to New conversation.
Record enablement evidence without credentials; do not mark this feature complete for a plan-only change.
Confirm the implementation PR created the removal ticket with a bidirectional dependency and updated the lane index.
