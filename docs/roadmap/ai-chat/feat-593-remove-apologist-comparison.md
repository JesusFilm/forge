---
id: "feat-593"
title: "Remove temporary Apologist comparison before public Chat release"
owner: "jian wei"
priority: "P1"
status: "not-started"
start_date: "2026-10-02"
duration: 1
depends_on:
  - "feat-551"
blocks: []
tags:
  - ai-chat
  - apologist
  - removal
---

## Problem

The comparison is an internal temporary experiment. Complete removal before the
public-release register feat-339 can close; disabling the switch is only rollback.
If feat-551 is canceled instead of shipping, record that disposition here and in
feat-339 before closing the removal requirement.

## Entry Points — Read These First

1. `docs/operations/apologist-comparison.md` — configuration and lifecycle.
2. `apps/chat/src/features/apologist/` — dedicated client, protocol, controller,
   view, lazy boundary, server config/gate/prompt/provider/handler and tests.
3. `apps/chat/src/app/api/apologist/route.ts` — signed-session request entry.
4. `apps/chat/src/components/shell/app-shell.tsx` — comparison entry and lifecycle.
5. `apps/chat/src/app/page.tsx` and `apps/chat/src/app/c/[id]/page.tsx` — capability.
6. `apps/chat/src/lib/use-conversations.ts` — read-only snapshot exposure.
7. `apps/chat/src/components/chat/message-list.tsx` — comparison-only `providerLabel` presentation prop.

## Grep These

`Apologist`, `apologist`, `APOLOGIST_`, `comparisonEnabled`, `comparisonId`,
`ComparisonBoundary`, `useComparison`, `comparisonAllowed`, `getSnapshot`, `providerLabel`,
`@ai-sdk/openai-compatible`.

Rename covenant: any change moving or renaming these symbols before removal must
update this ticket's paths/searches and preserve its public-release trigger.
Search executable code, package metadata, tests, docs, and deployment settings;
keep historical plans and operational documentation clearly marked as retired.

## What To Build

Delete the feature directory and API route; remove page capability imports/props,
shell entry/button/lazy boundary/state/action resets, and dedicated comparison
coverage. Remove the `UseConversations.getSnapshot` exposure if unused after
removal, but preserve the session's own snapshot mechanism.
Remove chat-only `ai` and `@ai-sdk/openai-compatible` dependencies when no other
Chat caller uses them, and regenerate `pnpm-lock.yaml`. Do not remove another
app's SDK dependency. Remove the comparison-only `providerLabel` prop and branches from `MessageList`
and `AssistantTurn`; preserve ordinary streaming announcements.
Update Chat README, AGENTS and CLAUDE guidance and the operations guide.

Binding keep-list: the existing Forge session and persistence decisions;
Seeker route/gate and allowlist; auth issuance/cookies/logout; Mastra history,
replay, rename, deep links and ownership; follow-ups/promptSource, sources and
featured videos; normal composer behavior; existing telemetry; safe Markdown.
No Mastra, database, auth or public-release gate redesign belongs to this ticket.

Operator cleanup is separate from code removal: remove all `APOLOGIST_*` settings
from Forge Chat deployment through the normal rollout process after the code
lands. Preserve Core credentials, Core deployments, Forge tracing settings and
all Seeker settings. Confirm no retired route remains deployed.

## Constraints

Do not claim removal complete from a false switch alone. Do not delete shared
provider credentials. Do not deploy local worktrees directly to production.
Link this ticket in feat-339 and keep its dependency on feat-551 bidirectional.

## Verification

Run Chat tests, lint with zero warnings, typecheck, build and touched-file format
checks. Search for remaining executable references using the patterns above.
Verify ordinary signed-in sends/follow-ups reach a terminal Forge answer, refresh
restores history, rename and navigation still work, and source/video rendering
remains available. Confirm initial browser requests include no comparison code
or provider calls and compare page-load measurements with the pre-removal build.
Record operator configuration cleanup separately before closing feat-339's item.
