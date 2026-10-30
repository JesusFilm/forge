---
title: "An AI agent and a person who edit the same record need one versioned write path"
date: 2026-10-07
category: architecture-patterns
module: apps/admin push campaigns
problem_type: architecture_pattern
component: service_layer
related_components:
  - data_model
  - api_layer
  - frontend
severity: high
applies_when:
  - "An MCP tool and a dashboard form both write the same record"
  - "A write computes a diff from one read and then saves it with a compare-and-set"
  - "An asynchronous step (a test send, a review, an approval) gives a status to content that can change while the step runs"
  - "A dashboard form must keep the typed text when the server refuses a save"
root_cause: concurrency
tags:
  [
    optimistic-concurrency,
    compare-and-set,
    content-version,
    mcp,
    push-campaigns,
    server-action,
    lost-update,
    ai-provenance,
  ]
---

# An AI agent and a person who edit the same record need one versioned write path

## Context

feat-613 lets an agent draft an Announcement Campaign through the JFP Admin MCP (`push.campaign.create`, `push.campaign.update`). A person then edits, tests, and sends the same campaign in the dashboard. Both writers can change one campaign within minutes. A test send runs as a workflow, so the content can also change while a test is in flight.

With "the last write wins", three failures are silent:

- An agent update erases a hand edit, or a hand save erases an agent update.
- A test send counts for copy that it did not send. TESTED is the gate before a real send, so untested copy can go to every phone.
- Every dashboard Save after a test moves the campaign from TESTED back to DRAFT, because the form posts every field even when nothing changed.

The operational rules are in `apps/admin/CLAUDE.md`, section "Agent drafts and the content version (feat-613)". This note records why each rule exists and the traps that the code review and the production checks found.

## Guidance

### 1. Send every content writer through one function

`writePushCampaignContent` and `createPushCampaignContent` in `apps/admin/src/services/push/campaign-content.service.ts` are the only content writers. The MCP create, the MCP update, and the dashboard save call them. The `source` value (`"mcp"` or `"dashboard"`) changes only how the input is parsed and merged, and the AI marker. A second write path for the agent would need its own version check, and the two checks would drift.

### 2. Compare and set in one conditional update

A `contentVersion` integer is the one revision of the copy, the destination, and the audience. The write is one `updateMany` on the id, an editable status, and the expected version. It raises the version by one (`campaign-content.service.ts:528-548`). When `count !== 1`, `refuseLostWrite` reads the row again and throws a typed error: not found, frozen, or stale with the last actor and time (`:445-459`). This is the conditional-update idiom of [db-lock-must-be-atomic-update-not-select-for-update](../database-issues/db-lock-must-be-atomic-update-not-select-for-update.md), with a version in place of a lock flag.

### 3. Bind the expected version to the snapshot that the diff came from

This is the bug that `ce-code-review` found before merge. The first version read `before`, built the diff from it, and then compared only the caller's `expectedContentVersion` in the `WHERE`. The caller supplies that number, so it can differ from `before.contentVersion`:

1. The server reads `before` at version 3.
2. The caller sends version 4, for example a revision from an older or a different read.
3. Another writer saves, and the stored version becomes 4.
4. `WHERE contentVersion = 4` matches. The diff, built against version 3, writes over the other writer's audience and copy.

The fix refuses the write as stale when `before.contentVersion !== input.expectedContentVersion` (`campaign-content.service.ts:508-512`). The conditional update stays as the guard against a write between the read and the update. The real-Postgres test "refuses a writer whose version belongs to a write after its read, and keeps that write (R34)" puts the second write exactly after the first read (`campaign-content.db.test.ts:333`).

The general rule: in a read, diff, and compare-and-set write, the version in the `WHERE` must be the version of the row that you diffed. A version that the caller supplies is not enough.

### 4. Let a save that changes nothing write nothing

The function builds the diff first. When nothing changed, it returns `written: false` and does not raise the version or change the status (`:495-506`). A TESTED campaign then stays TESTED after a Save with no change. The status check runs before the diff, so a frozen campaign is refused even for a call that changes nothing. The no-op return comes before the version check, because a write that changes nothing cannot lose another write.

### 5. Pin an asynchronous result to the version that it used

`pinPushTestContentVersion` writes `lastTestContentVersion` with the same version condition as a save (`apps/admin/src/services/push/campaign.service.ts:136-150`). `recordPushTestSend` sets TESTED only when `contentVersion` still equals that pin, a column-to-column comparison in the `WHERE` (`:157-181`). A change during the test leaves the campaign DRAFT. A run with no pin, for example one that started on code from before the deploy, also leaves it DRAFT. The pin is written after the check for a second run (`dispatch.ts:318-324`), so a refused test send does not move the pin of the run in flight.

### 6. Keep the agent marker separate from the content

Only an MCP write sets `aiLastActorId` and `aiLastWrittenAt`: an update with `source: "mcp"` (`campaign-content.service.ts:543-545`) or the MCP create (`:631-632`). Nothing clears them, so a later hand edit keeps the marker, and the reviewer still sees that an agent wrote part of the copy. The marker says nothing about translation quality.

### 7. Make a stale refusal keep the typed text

- A hidden `contentVersion` input sends the version that the page loaded (`apps/admin/src/app/dashboard/push-campaigns/components/campaign-editor.tsx:93-97`).
- React resets a `<form action>` form after its action. The editor submits through `onSubmit` with `preventDefault` and `startTransition(() => formAction(data))`, which skips that reset (`:82-88`).
- `key={campaign.contentVersion}` on the fields (`:99`) mounts them again only when a newer version loads. A refused save keeps the version, so the typed text stays.
- The action answers with a typed `stale` state (`apps/admin/src/app/dashboard/push-campaigns/components/action-state.ts:20`). The page shows "Load the latest version" behind a confirmation, because the reload discards the typed text (`apps/admin/src/app/dashboard/push-campaigns/components/load-latest-version.tsx`). The refusal clears when the page shows that version (`action-state.ts:28-35`).

## Why This Matters

The agent works fast and in bulk, and the person works in a browser tab that can stay open for hours. Without a version check, the two writers erase each other's work, and no error tells either of them. The status gate is only as good as its link to the content: a TESTED status that does not name the tested version can send copy that no person saw on a phone.

## When to Apply

- An agent tool and a dashboard form write the same record. [experience-locale-content-revision-draft-gateway](../cms/experience-locale-content-revision-draft-gateway.md) is the other model in this repo: one active draft revision per Experience locale under a row lock, where the last completed save wins and nothing detects a conflict.
- A write builds its payload from an earlier read and then saves with a compare-and-set.
- An asynchronous step gives a status to content that can change while the step runs.

## Examples

Production checks with Claude Code and Claude in Chrome, 2026-10-07, after #2597:

- The agent changed only the Spanish row of a draft. The revision went from 1 to 2, and the English row kept its id.
- A Save from a dashboard page loaded at revision 1 was refused. The message named the newer change and the AI marker, the typed text stayed in the form, and the revision stayed 2.
- "Load the latest version" asked for confirmation and then loaded revision 2.
- A Save with no change showed "Nothing changed, so the campaign keeps its status." The revision stayed 2.
- A hand edit raised the revision to 3, and the AI marker still showed the agent write.

A known gap, from the review and not applied as of 2026-10-07: agent copy can contain a line break, and `PushCampaignCopyInputSchema` only trims it (`apps/admin/src/services/push/contracts.ts:40-47`). The dashboard sends the title through an `<input>` and the body through a `<textarea>` (`campaign-editor.tsx:253`, `:271-272`). Per the review, the browser changes those line breaks, so a Save with no visible change is not a no-op and moves TESTED back to DRAFT. This session did not reproduce it. A fix normalizes line breaks in one place before the diff, or refuses them in agent copy.

## Related

- [db-lock-must-be-atomic-update-not-select-for-update](../database-issues/db-lock-must-be-atomic-update-not-select-for-update.md): the conditional-update idiom this pattern uses.
- [studio-command-revisions-and-publication-latch](../database-issues/studio-command-revisions-and-publication-latch.md): another revision model, with a row lock and receipts.
- [new-mcp-scope-needs-stored-scope-migration-for-dynamic-clients](../auth/new-mcp-scope-needs-stored-scope-migration-for-dynamic-clients.md): the scope rollout for the same feature.
- Plan: `docs/plans/2026-10-06-1100-feat-push-campaign-mcp-drafts-plan.md` (R34-R37, KTD5, KTD15).
