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
match. The first approved entry was merged in
[#2423](https://github.com/JesusFilm/forge/pull/2423) after eligibility CI passed.

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

## Operator setup and verification

The six `RAG_PORTAL_*` service variables were configured on the Forge RAG
Railway production service after [#2416](https://github.com/JesusFilm/forge/pull/2416)
merged. The OAuth app uses that service's HTTPS origin and exact
`<origin>/portal/callback`. The server-only GitHub token, OAuth client secret
and restricted portal-session database URL were sourced from Doppler; the
separate CI review token is a GitHub Actions secret. Keep these values out of
the browser, logs and repository. The session role has only `USAGE` on
`portal_private` and `SELECT`, `INSERT`, `DELETE` on `oauth_states` and
`sessions`; its corpus and `consumer_private` reads were denied in the
operator permission check.

The allowlisted login, protected identity response, sign-out, next-request
unauthorized response and unlisted-account denial were observed in a real
browser on 25 September 2026. The
[feat-527 admission evidence](../../../docs/roadmap/rag/evidence/feat-527/portal-admission-slice.md)
records completed checks and remaining operational checks without secret values.
Still check session persistence across restart, merged allowlist removal and
next-action denial, forced GitHub outage/stale-publication behavior, live
state-replay and cookie properties, and redacted browser/network/log leakage.
Use a reviewed PR for allowlist changes.

The portal feature is disabled when all six `RAG_PORTAL_*` service variables
are absent. Partial configuration fails service startup. Production now has
all six variables, so the admission portal is enabled. It still cannot create
consumers or issue credentials; that backend work remains in feat-527.
