---
title: "Use one ContentRevision draft gateway per Experience locale"
category: cms
module: "Admin Experience publishing"
date: 2026-08-20
problem_type: architecture_pattern
component: service_layer
severity: high
applies_when:
  - "Editing published Experience content without changing the live page"
  - "Exposing a shareable preview that follows the active draft lifecycle"
tags:
  - experience
  - drafts
  - content-revision
  - publishing
  - preview
  - concurrency
---

# Use one ContentRevision draft gateway per Experience locale

## Context

An Experience translation is stored and published as its own `ExperienceLocale`.
Writing editor, GraphQL, MCP, or AI changes directly to that canonical row makes
Save indistinguishable from Publish and lets different write paths disagree about
which version is editable.

## Guidance

Treat the active `ContentRevision` for an `ExperienceLocale` as the complete
editable version. All Experience write paths pass through the same service
gateway in `apps/admin/src/services/experience.service.ts`:

- the first save snapshots the canonical locale into a draft and merges the
  submitted fields;
- later partial saves merge into the active draft snapshot;
- a locale row lock serializes saves, producing intentional last-completed-save
  wins behavior without stale-write rejection;
- reads used by editors return canonical and effective draft state separately;
- publish snapshots the previous canonical state, applies the full draft, and
  retires the active draft in one transaction;
- discard retires the draft without changing canonical content.

Key the draft by `ExperienceLocale.id`, not the parent `Experience.id`. That lets
English and Russian versions of one Experience maintain independent drafts and
publish lifecycles. Parent-owned fields such as template designation do not
belong in the locale draft contract.

Issue a stable, high-entropy preview token on the active revision. The public
resolver in `apps/admin/src/services/experience-preview.service.ts` accepts only
an active Experience-locale draft, and the web route at
`apps/web/src/app/(preview)/preview/experience/[token]/page.tsx` renders it with
uncached, no-index behavior. Publishing or discarding retires the revision, so
the same lookup stops resolving without a separate expiry job.

Keep public side effects outside the staging path. Revalidation and route
manifest refresh happen only after the publish transaction commits; Save and
Discard do not change ordinary public Experience or Homepage reads.

## Why This Matters

A single aggregate boundary makes the live/draft distinction consistent across
Admin UI, GraphQL, MCP, and AI editing. Full snapshots keep preview and publish
deterministic, while partial inputs remain convenient for callers. Locale-level
identity preserves the product rule that translations are separate Experiences.

## When to Apply

- A published content row must remain live while editors prepare changes.
- Several interfaces can edit the same content aggregate.
- Preview must show the latest saved draft but remain absent from discovery.
- Collaboration intentionally uses one shared last-save-wins draft.

## Examples

For a published English homepage, Save changes only its active revision. The
ordinary English homepage continues reading the canonical row, while the token
preview reads the revision snapshot. A Russian save creates a different active
revision because its `ExperienceLocale.id` differs. Publishing English promotes
only the English revision and invalidates only its preview token.

## Related

- `docs/plans/2026-08-20-1607-feat-experience-draft-staging-plan.md`
- `docs/solutions/cms/admin-app-data-model-decisions.md`
- `apps/admin/prisma/schema.prisma`
