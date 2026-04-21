# Admin CMS Operational Vs Deferred

## Operational Now

- Experience index and draft creation on `/dashboard/experiences`
- Experience locale editor on `/dashboard/experiences/[id]`
- Locale publish action from the admin app
- Locale revision/audit timeline backed by `content_revision`
- Role-shaped navigation for admin-only surfaces (`users`, `settings`)
- Admin-only access enforcement on `/dashboard/users` and `/dashboard/settings`

## Operational But Still Read-Heavy

- `/dashboard/videos`
- `/dashboard/media`
- `/dashboard/workflows`
- `/dashboard/embeddings`
- `/dashboard/search`

These surfaces expose real data and some operator actions, but they are not yet
complete editorial workflows.

## Deferred

- Full video editing and locale-authoring workflow parity
- Media library curation and upload management
- Restore / rollback from revision history
- User-management actions beyond visibility
- Settings mutation surfaces and guarded admin actions
- Search-to-edit handoff that jumps directly into matching records
- Rich workflow-run history beyond current operational state views

## Current Boundary

The admin app now owns a real editorial path for experiences, but it does not
yet replace the broader CMS for every content or operator workflow. The next
follow-up should expand video and media editorial flows rather than broadening
the experience editor indiscriminately.
