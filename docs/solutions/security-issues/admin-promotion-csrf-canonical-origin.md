---
module: Admin recommendation operations
date: 2026-09-30
problem_type: integration_issue
component: authentication
symptoms:
  - Canonical Admin promotion POSTs returned csrf_failed behind the production proxy
  - The browser presented every 403 response as missing role authorization
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [admin, csrf, proxy, recommendations, operator]
---

# Bind operator CSRF checks to the configured Admin origin

The authenticated recommendation operator displayed ADMIN, but confirming an
emergency stop returned 403 before mutation. An unauthenticated diagnostic with
the canonical HTTPS Origin, exact custom CSRF header and JSON content type also
returned `csrf_failed`, identifying the guard rather than the account role.

`apps/admin/src/app/api/recommendations/promotion/route.ts` compared the browser
Origin with `new URL(request.url).origin`. The request URL is transport-derived
and can represent internal HTTP behind a TLS-terminating proxy. Use the existing
`isTrustedReturnToOrigin` helper in `apps/admin/src/auth/origins.ts` to compare
exactly with the configured Admin origin. Do not add an internal-origin fallback
or trust Host/forwarded headers supplied with the request. Preserve the custom
CSRF header, content type, session, role, recent-authentication and generation
checks independently.

Test canonical HTTPS Origin against an internal HTTP URL, plus missing, null,
malformed, attacker and internal origins with spoofed forwarding headers. A valid
origin without a session must reach the ordinary 401 boundary; it must never
authorize an action by itself. Decode only recognized error envelopes in the UI
so CSRF refusal is distinguishable from `permission_denied`; malformed responses
remain refusals and never trigger an automatic mutation retry.

The separate browser-confirmation repair uses ordinary accessible Confirm/Cancel
controls because the native confirmation was unavailable to automation and the
owner. Consume confirmation synchronously to prevent double submission, and
verify cancel/Escape issue no POST. UI confirmation and server authorization are
separate boundaries. See the [activation record](../../operations/recommendation-owner-live-activation-2026-09-30.md)
for local validation and point-in-time production observations.
