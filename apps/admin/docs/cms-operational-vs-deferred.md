# Admin CMS Operational Vs Deferred

## Operational Now

- Experience index and draft creation on `/dashboard/experiences`
- Experience locale editor on `/dashboard/experiences/[id]`
- Locale publish action from the admin app
- Locale revision/audit timeline backed by `content_revision`
- Role-shaped navigation for admin-only surfaces (`users`, `settings`)
- Admin-only access enforcement on `/dashboard/users` and `/dashboard/settings`

## Operational But Still Read-Heavy

- `/dashboard/videos` — paginated browsing, labels, thumbnails, and public
  watch-page handoff links are operational; editing remains deferred.
- `/dashboard/media`
- `/dashboard/embeddings`
- `/dashboard/search`

These surfaces expose real data and some operator actions, but they are not yet
complete editorial workflows.

`/dashboard/workflows` is intentionally operational rather than editorial: the
index lists real Workflow runtime runs, and `/dashboard/workflows/[runId]`
embeds the library-provided trace/detail UI from `@workflow/web-shared`.

## Deferred

- Full video editing and locale-authoring workflow parity
- Media library curation and upload management
- Restore / rollback from revision history
- User-management actions beyond visibility
- Settings mutation surfaces and guarded admin actions
- Search-to-edit handoff that jumps directly into matching records
- Workflow action controls beyond the embedded trace/detail inspection surface

## Current Boundary

The admin app now owns a real editorial path for experiences, but it does not
yet replace the broader CMS for every content or operator workflow. The next
follow-up should expand video and media editorial flows rather than broadening
the experience editor indiscriminately.
