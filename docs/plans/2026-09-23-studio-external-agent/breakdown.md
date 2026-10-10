# Proposed ticket breakdown

Status: approved by the operator on 2026-09-23. Published as `feat-542` through
`feat-548`, preserving the dependency graph below.

## Primary test boundary

Exercise the authenticated MCP surface through canonical persisted state and
actual render artifacts. Use the existing database seam for atomic admission,
retry/allowance and race guarantees, and the human UI for exact-output approval.
Fake only the paid provider in routine tests. Actual Claude and Codex connections
are required for final compatibility acceptance.

This keeps tests focused on the workflow the operator experiences while using
lower boundaries only for guarantees that cannot be reliably proved by a client
smoke test.

## Slices

| Ticket                                                                                                    | Blocked by | Demonstrable outcome                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [01 — Connect an external agent and edit the correct project](tickets/01-connect-and-edit.md)             | None       | An operator connects an existing external client, discovers or opens the intended project, makes an attributed edit, and sees that edit in Studio.                                                               |
| [02 — Request and retrieve an exact draft render](tickets/02-render-a-draft.md)                           | 01         | The connected agent requests a render of its current draft, checks progress after reconnecting, and retrieves scoped media access plus a human link to the exact output.                                         |
| [03 — Generate draft narration within a durable allowance](tickets/03-bounded-draft-narration.md)         | 01         | The agent uses an approved existing voice to generate and attach draft speech without pausing for preliminary script approval.                                                                                   |
| [04 — Inspect a rendered draft quickly with attributable evidence](tickets/04-fast-render-inspection.md)  | 02         | The external agent retrieves a bounded evidence package for the exact rendered draft, performs a quick quality pass, and hands off honest findings and inspection coverage..                                     |
| [05 — Review an exact draft and revise from conversation feedback](tickets/05-review-and-revise.md)       | 02, 04     | The human follows the agent handoff to review an exact render, gives feedback in their existing conversation, optionally makes direct edits, and receives a reconciled revision with accessible prior evidence.. |
| [06 — Create and revise from a broad brief using a portable skill](tickets/06-portable-creation-skill.md) | 03, 05     | An operator invokes the same creation workflow in Claude or Codex.                                                                                                                                               |
| [07 — Qualify Claude and Codex through the full review loop](tickets/07-qualify-both-clients.md)          | 06         | Prove the complete experience in each supported client and publish an actionable onboarding and release checklist tied to observed behavior..                                                                    |

## Sequencing

Start with 01. Once it lands, 02 (render) and 03 (narration) can proceed
independently. 04 needs actual rendered artifacts from 02. 05 consumes exact
render identity and inspection evidence, but does not need narration to prove
conversation feedback. 06 combines the available paths into the full creative
workflow. 07 qualifies that workflow in both clients.

No standalone refactor ticket is justified by current evidence. Any small adapter
extraction belongs in the slice whose outcome needs it; do not build a parallel
execution system as a prerequisite.

## Publication and review

Review these concrete drafts for granularity, dependency accuracy, and merge/split
preferences. Also review the specification's test boundary and interpretation of
a draft narration allowance as stable across one project's revisions and sessions.

After approval, recheck the highest global `feat-NNN` ID, publish one file per
slice under the media-generation roadmap, add exact implementation entry points
from the companion code map, set `status: "not-started"`, retain
`ready-for-agent` readiness separately, and write both `depends_on` and reverse
`blocks` edges. Replace temporary 01–07 references with the allocated IDs.
Completed foundation tickets are references rather than artificial blockers.

Implementation starts only after the specification/ticket task; this task does
not change application code or deploy services.
