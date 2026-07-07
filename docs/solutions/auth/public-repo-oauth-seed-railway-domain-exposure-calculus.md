---
title: "Publishing a Railway domain as a first-party OAuth redirect in a public repo — exposure calculus and seed/domain lifecycle coupling"
date: 2026-07-06
category: auth
module: "apps/auth, apps/chat"
problem_type: best_practice
component: authentication
severity: medium
applies_when:
  - "Registering a first-party OAuth client's redirect URI on a Railway-generated service domain (*.up.railway.app) before a custom DNS hostname is provisioned"
  - "The redirect URI or seed row about to be committed lives in a public repository, so the commit itself is the disclosure event"
  - "The OAuth client is public/PKCE with autoApprove or skipConsent (consent-skipping), so token issuance needs no user consent screen"
  - "Deciding whether to accept a Railway-generated domain as the settled production hostname pre-DNS (kind production vs a preview-kind client fronting a live surface)"
  - "Planning a DNS cutover, service re-provisioning, or full decommission for an app whose domain is referenced by an existing OAuth seed entry"
  - "Widening the scopes of, or turning on an expensive feature flag behind, an OAuth client whose redirect host is already published"
related_components:
  - development_workflow
tags:
  - oauth
  - railway
  - public-repo
  - redirect-uri
  - pkce
  - domain-lifecycle
  - dangling-redirect
  - seed-data
---

# Publishing a Railway-generated domain as a first-party OAuth redirect in a public repo

## Context

Registering a deployed first-party OAuth client in `apps/auth` means committing the exact redirect host into the seed — `CHAT_APP_SEED` in `apps/auth/src/domain/apps.ts` — and that file lives in the public JesusFilm/forge GitHub repo. The moment the seed PR merges, the deployed service's URL is public knowledge. For chat (feat-231, PR #1465, merged 2026-07-06), pre-DNS, that host is a raw Railway-generated domain (`forgechat-production-a4f5.up.railway.app`), not a Cloudflare-fronted `jesusfilm.org` name — no WAF, no rate limiting, no DNS indirection in front of it. The question this framework answers: is publishing that URL safe, and what discipline must accompany it?

This is not the same question as the mastra-studio preview-host pattern (`docs/solutions/platform/mastra-studio-gateway-auth-railway-pattern-20260522.md`), which covers seed _shape_ for per-PR ephemeral hosts. This is the exposure and lifecycle calculus for one stable published host. The answer for feat-231 was "yes, safe to publish" — but that verdict is conditional on a specific set of controls (below), and it is scoped to _this_ client: an identity-only, gates-nothing consumer. The controls are what make it safe; the verdict does not transfer to a client that lacks them.

## Guidance

### Check 0 — prefer eliminating the reclamation risk over managing it

Before working the checklist, ask the cheaper question: does a permanently-owned domain (the `jesusfilm.org` DNS name, fronted by Cloudflare) need to exist for this service anyway, and can it be provisioned _first_? If yes, that dominates every check below — a redirect host we permanently control can never be squatter-reclaimed, so the entire dangling-redirect chain in check 2 becomes impossible, and the missing-WAF/rate-limit gap closes at the same time. The rest of this framework is for when you have made the deliberate decision to publish a raw provider-generated host _before_ that owned domain exists (as feat-231 did, pre-DNS). Managing the reclamation risk with lifecycle discipline is strictly worse than not creating it; only accept the raw host when provisioning the owned domain first is genuinely not on the table yet.

If you do proceed with the raw host, run the four checks below before merging. All four must come back clean; a missing condition changes the verdict.

### 1. Exposure is conditional on what the origin serves — and it is an ongoing invariant, not a pre-merge gate

Publishing the URL only widens the audience for what the origin actually serves an unauthenticated caller. Chat's expensive surface (the Seeker → Mastra proxy) refuses server-side: `apps/chat/src/app/api/seeker/route.ts` gates in order "enable flag → config present → SSRF" and emits a terminal `fail("config_missing")` frame when the flag is off — so a scraper who finds the URL and POSTs directly to `/api/seeker` gets a dead end, not a paid Mastra generation. The flag is a string-boolean: `isSeekerChatEnabled()` in `apps/chat/src/config/env.ts` returns true only for the literal `"true"`.

Three disciplines follow:

- The gate must be **server-side**, not UI-only. A hidden button proves nothing to a scraper with `curl`. Read the route handler, not the component.
- Publishing the URL **is** the "audience widening" that chat's accepted-risk notes (`apps/chat/CLAUDE.md`: `/api/seeker` unauthenticated + un-rate-limited) warn about. Check the deployed flag state (`SEEKER_CHAT_ENABLED` absent or not `"true"`) before the seed merges.
- **This is not a one-time gate — publication is permanent and the flag exists to be turned on.** The URL moves from "guessable" to "known" the moment the seed merges, and it stays known. So _enabling_ `SEEKER_CHAT_ENABLED` (or any expensive surface) on a published host is itself a trigger to re-run this check: the inbound-auth + rate/concurrency-cap prerequisites (per `apps/chat/CLAUDE.md`) must land FIRST. A "verified off at merge time" result silently expires the day someone flips the flag; whoever flips it owns re-verifying the gate.

### 2. The dominant worst case is the dangling-redirect window, not traffic

The seeded client is public PKCE with consent skipped: `apps/auth/src/scripts/seed-first-party-apps.ts` sets `skipConsent: environment.autoApprove`, and `CHAT_APP_SEED`'s production environment sets `autoApprove: true`. Railway subdomains are reclaimable. So the attack that matters is not what an attacker can do against the live service today — it is what a squatter can do if the domain is ever freed while the seed row (and its persisted OAuth client) still exist (the full chain is spelled out in Why This Matters).

**The operating rule: the seed row and the domain live and die together.** But "die together" hides a sharp asymmetry between two lifecycle operations, and getting it wrong reopens the exact window this rule exists to close:

- **Host change / DNS cutover (the client survives) — the safe path.** You change the `redirectUris` / `allowedOrigins` / `postLogoutRedirectUris` strings but keep the same `clientId`. The seeder upserts by `clientId`, and its `update` branch overwrites those fields wholesale — Prisma _replaces_ the array rather than merging, so dropping the old host from a multi-URI array genuinely removes it. The next auth deploy scrubs the old Railway host from the row. This is the "one-line merge" case, and it is correct. Ordering: merge the URL change and confirm the auth deploy has re-seeded _before_ you release the old Railway domain — the scrub only lands when the seed reruns.
- **Dropping or renaming the `clientId` (the trap).** The dividing line is not "change vs. remove a URL" — it is whether the `clientId` stays in the seed. `seed-first-party-apps.ts` is upsert-only (no `delete`/`deleteMany`/prune step) and only ever touches the environments present in the seed array. So _deleting_ the production block (a full decommission) **or** minting a fresh `clientId` for the new host and dropping the old one (a tempting "clean" cutover) both leave the old `jfp_chat_production` `OauthClient` and `AppEnvironment` rows live in auth's database — reclaimable redirect fully active. To actually retire a client you must disable or delete those rows out-of-band (there is no seeder path and, as of this writing, no CLI for it — treat building one as a prerequisite for executable decommission), or keep the seed entry and repoint `redirectUris` at a non-reclaimable sentinel host you control. Never assume "removed from the seed" means "gone from auth." The one-line-merge cutover above is safe precisely because it keeps the same `clientId`.

Because both branches depend on a human remembering to act _before_ the domain is freed, and the failure is completely silent, the procedural rule alone is a weak control for the doc's highest-impact risk. The domain can be released by events with no coupling to the repo at all — a billing lapse, an accidental Railway project deletion, a provider-side reclaim — none of which trigger a seed edit. Complement the procedure with **detection**: a lightweight periodic check that every seeded reclaimable-provider redirect host still resolves to a service we own (alert on NXDOMAIN or an ownership change). Detection is what catches the out-of-band release the runbook never sees.

### 3. Bounding controls — every one of these must hold

Each control shrinks the blast radius. But they do not all cover the same case, and the distinction is load-bearing: the state-cookie/PKCE binding, the PSL entry, and the exact-match/dynamic-allowlist pin all bound the **live** service (an attacker attacking chat's real host today). In the **dangling-reclaim** case the attacker _owns_ the exact seeded host and runs their own flow, so those three do nothing — there, the blast-radius reduction reduces almost entirely to **identity-only scopes**. Verify each when reusing the pattern; these are facts about _this_ client, not properties of the pattern, and a missing one changes the verdict.

- **Identity-only scopes — the STOP rule.** `CHAT_DEFAULT_SCOPES = ["openid", "profile:read", "email:read"]` (`apps/auth/src/domain/apps.ts`) — deliberately no `*:access` and no `membership:read` (feat-207 R7). A harvested token asserts who someone is; it opens no admin, manager, or membership door. **This is the one control that bounds the dangling-reclaim case, so it is a hard gate, not a nice-to-have:** for a consent-skipping public client whose scopes include ANY `*:access` or write scope (e.g. `admin:access`, `manager:access`, `web:watch-events:write`), a reclaimable published redirect is categorically unacceptable — the same dangling-redirect chain yields silent account takeover / privilege escalation on behalf of arbitrary victims, not identity disclosure. Do not carry the "safe to publish" verdict to such a client. Widening _this_ client's scopes later is the likelier future change than reuse, and it is guarded only by prose here — treat any scope expansion on a published-host client as a trigger to re-run this whole calculus, and consider a scope-pinning test analogous to the negative redirect test below.
- **Audience-bound tokens limit replay.** `verifyChatIdToken` checks `audience: clientId`, so a squatter's harvested id*token (`aud=jfp_chat_production`) cannot be replayed to impersonate the victim at \_other* first-party services that validate their own audience. This bound is real and worth stating — but it evaporates if a downstream consumer skips audience validation, so it constrains lateral movement, it does not undo the identity disclosure at the reclaimed client.
- **State cookie + PKCE double-binding defeats login-CSRF.** `apps/chat/src/auth/oauth-state.ts` mints a per-attempt `state` + S256 verifier into transient cookies; `apps/chat/src/app/api/auth/callback/route.ts` rejects on `state` mismatch and requires the browser-held verifier cookie to complete the code exchange. Note this protects _chat's_ flow — not a flow the attacker initiates themselves, which is exactly why it does not touch the dangling-reclaim case.
- **Public Suffix List blocks cookie-tossing.** `up.railway.app` is on the PSL, so sibling Railway tenants cannot set parent-domain cookies onto chat's host. This is a provider-dependent fact, not something the repo controls or monitors — a browser lagging the PSL, or Railway delisting, weakens it silently.
- **Exact-match redirect, client pinned OUT of the dynamic allowlist.** `DYNAMIC_PREVIEW_CLIENT_IDS` in `apps/auth/src/services/dynamic-preview-redirect.service.ts` contains only admin and mastra-studio ids, so `isDynamicRailwayPreviewRedirectUriAllowed` returns false for `jfp_chat_production` — it cannot have look-alike Railway hostnames dynamically registered. PR #1465 added a **negative test** asserting this (see Examples); without it, someone extending the allowlist for a future chat preview could silently widen production.
- **No certificate-transparency leak vector (provider-dependent).** Railway serves the wildcard `*.up.railway.app` certificate, so the hostname does not currently appear in CT logs; discovery is limited to scraping, guessing, or publication. Treat this as a mutable provider behavior, not a durable secrecy control — attaching a custom domain to the service, or a Railway move to per-service certs, would surface the host in CT logs with no notice to us. It is why check 1 (gate location) carries the weight it does: do not lean on "not in CT" to keep a host quasi-secret.

### 4. Prefer an honest `kind: "production"` over a mislabeled preview client — but treat the raw-host posture as time-boxed

When the Railway-generated domain IS the settled production hostname for now (no DNS yet), register it as the production client — `jfp_chat_production`, `kind: "production"` — not as a preview client that happens to point at prod. The seed's `kind` field is persisted as `environmentKind` in the OAuth client's metadata (`apps/auth/src/scripts/seed-first-party-apps.ts`), which token issuance logs and audits carry; labeling real production sign-ins "preview" would misrepresent every audit row. The contrast case is mastra-studio, whose Railway host genuinely is the preview surface and is seeded under `jfp_mastra_studio_preview` accordingly.

Keep two claims separate. Labeling accuracy: call it production — correct. Security posture: a production auth origin with no WAF, no rate limiting, and no DNS indirection is a **time-boxed exception, not a settled end state.** Attach a tracked follow-up for the Cloudflare-fronted DNS cutover rather than leaving "production on a raw host" open-ended — the honest label must not quietly bless the missing edge-protection layer as permanent. This matters most for a client whose sensitive surface is the auth flow itself (authorize/callback/token) rather than a separate flag-gated proxy: shipping that directly on a raw, un-rate-limited host invites credential-stuffing and token-endpoint abuse.

## Why This Matters

The dangling-redirect chain is the concrete worst case the checklist defends against, step by step:

1. The seed row persists in auth's database: a public PKCE client (`public: true`, no secret), `skipConsent: true`, redirect exact-matched to `forgechat-production-a4f5.up.railway.app`.
2. The chat service is deleted or renamed; Railway frees the subdomain on the shared `up.railway.app` apex. (Note the persisted OAuth client does not go with it — see check 2, decommission branch.)
3. A squatter claims the freed subdomain (its exact spelling is public — it's in the repo). They now own a valid, exact-match, consent-skipping redirect target for a live first-party client.
4. The squatter initiates an authorize flow themselves — they hold the `state` and the PKCE `code_verifier`, so chat's CSRF double-binding is irrelevant (it binds chat's flows, and this is the attacker's flow).
5. A victim with an active SSO session clicks the attacker's link. `skipConsent` means no consent screen renders; auth silently 302s the authorization code to the attacker's host.
6. The client is public — no secret is needed to exchange the code. The attacker receives tokens carrying `openid` / `profile:read` / `email:read` → silent identity harvesting (name, email, sub), wearing a first-party client id the victim has every reason to trust.

What bounds the damage to "identity disclosure" rather than "privilege escalation" is identity-only scopes (check 3) — reuse for a client with broader scopes inherits the chain _without_ that bound and escalates to account takeover. "Silent" is the operative word: a dangling redirect produces no error and no log line on our side; the tokens flow to the squatter and nothing looks broken, which is why check 2's detection recommendation matters.

**Calibrate the impact to this audience, not a generic one.** The reflex is to rate identity disclosure "moderate." For JesusFilm, that may badly understate it: the audience is global and plausibly includes people in regions where being identified as viewing Christian content carries real personal-safety risk. Silently deanonymizing "who is signed in, and their email," wearing a trusted first-party client id, can be a high-severity exposure for those users — not a moderate one. The higher the impact rating for the actual at-risk user base, the more check 0 (eliminate the risk by owning the domain first) dominates, and the less acceptable it is to sit on a reclaimable-host state for long.

The cost-risk profile is otherwise asymmetric. Present-day cost of publishing is low **when the checks hold** — server-side gate + flag off means no exploitable surface, identity-only scopes cap token value, the wildcard cert means the merge adds no new discovery channel. Against that sits a low-probability failure whose _impact_ depends entirely on the user base and the scopes, materializing only if the lifecycle rule is ignored. Because the risk lives at a future lifecycle event, the reasoning must be discoverable then — not buried in a merged PR thread. A solutions doc is where the next engineer shipping a pre-DNS service, or executing the DNS cutover, will actually look.

## When to Apply

- Any time a Railway-generated — or other provider-generated, reclaimable — hostname is about to be committed as an OAuth redirect URI or allowed origin in a public repo. First ask check 0: can an owned domain be provisioned instead?
- At service re-provisioning or **full decommission**: the domain release is a security event. For a host change, update the seed in the same operation (it re-seeds on deploy). For a decommission, the seeder cannot retire the client — disable/delete the DB rows out-of-band, and do it before the domain is freed.
- At DNS cutover: retiring the raw Railway host from the seed (repointing `redirectUris` _and_ `postLogoutRedirectUris`, which are equally reclaimable) is part of the cutover change, not a follow-up. Cloudflare fronting protects only the new hostname; the Railway domain stays a live origin bypass until removed.
- When **turning on** a feature flag (e.g. `SEEKER_CHAT_ENABLED`) or otherwise exposing an expensive surface on an already-published host — re-run check 1 with rate-limit/WAF/auth prerequisites in place first.
- When **widening the scopes** of a client whose redirect host is already published — re-run check 3's STOP rule; identity-only is the load-bearing bound.
- When deciding preview-vs-production `kind` for a deployed client that has no DNS name yet — and attach the time-boxed cutover follow-up.
- When adding any new first-party app seed to `apps/auth` — inherit the negative-test and clientId-uniqueness-test patterns below.

## Examples

The worked instance is chat's production environment in `CHAT_APP_SEED` (`apps/auth/src/domain/apps.ts`):

```ts
{
  key: "production",
  kind: "production",
  clientId: "jfp_chat_production",
  redirectUris: [
    "https://forgechat-production-a4f5.up.railway.app/api/auth/callback",
  ],
  postLogoutRedirectUris: ["https://forgechat-production-a4f5.up.railway.app"],
  allowedOrigins: ["https://forgechat-production-a4f5.up.railway.app"],
  defaultScopes: CHAT_DEFAULT_SCOPES,
  autoApprove: true,
}
```

Both `redirectUris` and `postLogoutRedirectUris` sit on the reclaimable host, so both must be retired on the same lifecycle event (the post-logout URI on a reclaimed host is a phishing landing, not token theft, but still yours to retire).

The negative dynamic-redirect test pinning chat out of the wildcard machinery (`apps/auth/src/services/dynamic-preview-redirect.service.test.ts`):

```ts
it("does not widen the chat production client beyond its exact seeded redirect", () => {
  expect(
    isDynamicRailwayPreviewRedirectUriAllowed({
      clientId: "jfp_chat_production",
      redirectUri:
        "https://forgechat-anything.up.railway.app/api/auth/callback",
    }),
  ).toBe(false)
})
```

Seeding upserts by `clientId` (`apps/auth/src/scripts/seed-first-party-apps.ts`), so a copy-paste clientId collision between two apps would silently merge rows and still pass count/shape tests. PR #1465 added a global uniqueness test across ALL first-party seeds (`apps/auth/src/domain/apps.test.ts`):

```ts
const clientIds = FIRST_PARTY_APP_SEEDS.flatMap((app) =>
  app.environments.flatMap((env) => [
    env.clientId,
    ...(env.managerSessionServiceClientId
      ? [env.managerSessionServiceClientId]
      : []),
  ]),
)
expect(new Set(clientIds).size).toBe(clientIds.length)
```

Registration proof: the seed script prints a receipt on deploy — `Seeded 5 first-party apps, 18 environments, 22 OAuth clients, and 10 scopes.` The counts confirm chat's two environments (local + production) landed: 18 environments across the five apps, plus manager's four session-service clients making 22 OAuth clients. Note the same upsert-only script that prints this receipt is the one that cannot _remove_ a client — the receipt only ever grows or holds steady.

## Related

- `docs/solutions/platform/mastra-studio-gateway-auth-railway-pattern-20260522.md` — the closest prior art. It covers the seed SHAPE for per-PR ephemeral Railway hosts (one baseline preview URL plus just-in-time exact-match validation of generated hostnames). It answers "how do I seed hosts that churn per PR"; this doc answers "may I publish this one stable host at all, and what must I do when it dies". Complementary halves of the same "Railway domain as OAuth redirect" surface — cross-link both directions.
- `docs/solutions/architecture-patterns/hardened-oidc-id-token-verify-jose-jwks-20260702.md` — establishes chat as a "gates-nothing" identity-only consumer, the exact contract this doc's identity-only-scopes STOP rule leans on, and the source of the audience-binding bound in check 3.
- `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md` — the setup-side mirror of this teardown-side hazard: "receiver-registers-first" prevents a dead window at registration; the seed/domain lifecycle rule here prevents an exposure window at decommission.
- `apps/chat/CLAUDE.md` — the `/api/seeker` accepted-risk note and the feat-207 cookie/PKCE hardening this doc's bounds rely on.
