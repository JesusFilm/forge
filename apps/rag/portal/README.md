# RAG portal admission

`users.json` is the merged repository allowlist for **portal access only**. Each
entry has exactly `login` (GitHub handle) and `id` (stable positive GitHub numeric
account ID). Example:

```json
{
  "users": [{ "login": "engineer", "id": 123456 }]
}
```

Logins are normalized to lowercase; case-insensitive duplicate logins and
repeated IDs are invalid. A rename requires a reviewed edit retaining the same
numeric ID. A reassigned handle never inherits access because the ID must also
match. The initial list is empty until an engineer's identity and Forge write
permission can be verified through a PR.

The path-specific `rag-portal-allowlist` CI workflow emits a receipt with the
candidate commit SHA, normalized entries, predicate names and each check's
`pass`, `fail` or `unverified` outcome. It requires
`RAG_PORTAL_ELIGIBILITY_TOKEN` with repository administration-read visibility
for the private Forge collaborator-permission endpoint. An absent token,
private-visibility 404, incomplete response, rate limit or network error is
`unverified` and fails the job. A live `read`, `triage` or `none` permission,
missing account or identity mismatch is known ineligible and fails. A public
contribution or organization-membership check does not establish repository
write access. The receipt contains no token. A zero-entry list passes only
vacuously; it admits nobody.

Runtime admission reads `apps/rag/portal/users.json` at the current **merged**
`main` SHA through the GitHub API on every portal login and protected action.
It verifies the signed-in account's live handle and numeric ID and current
Forge `write`, `maintain` or `admin` permission. There is no cached permission
or stale publication grace period: unavailable/incomplete GitHub reads deny the
action. A PR head cannot grant admission before merge. The `/v1` bearer route
is independent of the portal session and keeps its existing credential path.
The portal currently exposes only login, a protected identity proof at
`GET /portal`, and sign-out; it cannot create consumers, issue keys, manage
members or read usage.

## Nonproduction operator setup and verification

These checks **have not passed in CI** and require Jaco/operator setup:

1. Register a nonproduction GitHub OAuth client with the exact HTTPS callback
   `<origin>/portal/callback`. Set `RAG_PORTAL_CLIENT_ID`,
   `RAG_PORTAL_CLIENT_SECRET`, `RAG_PORTAL_CALLBACK_URL`, and
   `RAG_PORTAL_ORIGIN` on the nonproduction Railway target. No production OAuth
   client or Railway setting is part of this change.
2. Provision a separate `portal_private` Postgres role with only `USAGE` on
   that schema and `SELECT`, `INSERT`, `DELETE` on `oauth_states` and
   `sessions`. Set its URL as `RAG_PORTAL_DATABASE_URL`. Apply the migration
   first. Verify sessions survive a service restart and that the role cannot
   read corpus or `consumer_private` data. Do not reuse the corpus writer or
   registry owner credential.
3. Set `RAG_PORTAL_GITHUB_TOKEN` to a server-only token able to read private
   Forge contents and collaborator permissions. Set the CI review token
   separately. Do not expose either to the browser.
4. In a browser, verify real allowlisted login and unlisted denial, exact
   callback host, secure HttpOnly SameSite cookies, state replay and sign-out.
   Merge an allowlist addition and removal in a nonproduction test flow;
   verify publication at the merged SHA, premerge denial and next-action
   removal. Check behavior through a restart and GitHub API outage.
5. Inspect redacted Railway logs and browser storage/network traffic for
   OAuth codes, provider tokens and session values. Confirm none appear in
   responses, logs, telemetry, repository files or browser persistence beyond
   protected HttpOnly cookies.

The portal feature is disabled when all six `RAG_PORTAL_*` service variables
are absent. Partial configuration fails service startup. These setup steps
must be finished and reviewed before enabling it on any Railway service.
