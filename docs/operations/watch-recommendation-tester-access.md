# Private Watch recommendation tester access

Code: feat-524. Production activation: feat-525.

Watch has no exposed login UI. A private link establishes a signed tester
cookie and redirects to `/watch`. It changes no Watch controls or layouts and
does not sign the holder into an account. The existing recommendation row can
appear only when its authored block is published and the server gate allows it.

## Production configuration

Merge through the normal PR-to-main deployment. Configure the Web service with:

- `WATCH_RECOMMENDATION_TESTER_SECRET`: a dedicated random secret, generated
  with at least 32 random bytes (for example `openssl rand -hex 32`). Store it
  through the deployment secret manager; never in source control or public env.
- `NEXT_PUBLIC_CANONICAL_ORIGIN`: the actual HTTPS origin used to open Watch.
  Issue links for that exact origin, without a `/watch` suffix.
- `LAUNCHDARKLY_SDK_KEY`: the Watch production environment's server SDK key.
- `WATCH_FOR_YOU_ENABLED=true`.
- `FORGE_WATCH_HOMEPAGE_RECOMMENDATIONS_DEFAULT=false` or unset. A true fallback
  would enable all contexts during SDK initialization failure or missing setup.

The secret is optional at boot: missing or weak values disable tester access.
Use independent secrets in different environments. Environment changes follow
the normal deployment process; do not publish a local worktree to production.

## LaunchDarkly targeting

[Watch production flag](https://app.launchdarkly.com/watch/production/features/forge.watch.homepageRecommendations):
`forge.watch.homepageRecommendations`, context kind `watch-recommendation-tester`.

These three non-secret IDs were configured on 2026-09-21:

| Tester    | Context key                            |
| --------- | -------------------------------------- |
| Nisal     | `411a8675-80df-483b-ac76-e98d0626c3a1` |
| Vlad      | `243da289-37ac-435a-b614-e14e028d143c` |
| Tataihono | `3bcb4d67-b787-49cd-8fc7-051a8562f996` |

Production is on, with these individual targets serving true, no targeting
rules, fallthrough false, and off variation false. The old email rule is removed.
The key alone grants nothing: Web requires a valid signed cookie before
evaluating this context kind. Flag configuration is verified independently of
code deployment; it does not prove production tester activation is available.

## Issue links after deployment

In a trusted terminal with the production signing secret injected into the
environment, run from the repository root, substituting the configured origin
and the chosen ID above:

```bash
pnpm exec tsx apps/web/scripts/create-recommendation-tester-link.ts \
  --origin https://www.jesusfilm.org \
  --tester-id 411a8675-80df-483b-ac76-e98d0626c3a1
```

The JSON output includes `testerId` and `activationUrl`. Without `--tester-id`,
the command generates a new ID which must also be individually targeted in LD.
Keep output private; do not run issuance in CI, paste links into PRs, or retain
them in logs. Deliver each link to its intended tester through an approved
private channel. This task has not issued or sent production links.

Opening a link in the tester's normal browser sets
`forge_recommendation_tester`: host-only, HttpOnly, SameSite=Lax, Secure in
production, and scoped to `/watch/api/recommendations`. Each browser needs to
open the link. Links can be reused during 24 hours; sessions end seven days
after link issuance, including repeated activations. Anyone holding a link can
activate that tester's rollout identity during those 24 hours. This mechanism
is suitable for feature previews, not authorization to private account data.

The activation credential is in a URL fragment. The standalone bridge strips
it from history before posting to the same-origin endpoint, loads no app assets
or analytics, and redirects to `/watch` after completion or a five-second
timeout. Expired/invalid links also redirect without granting access. The
normal Watch analytics flow is unchanged after redirect.

## Verify and revoke

Before publishing the homepage block, verify that a fresh browser gets
`{"enabled":false}` from `/watch/api/recommendations/for-you/availability`.
After activating a targeted link, it should return `{"enabled":true}`. Verify
the existing homepage recommendations block is published and check the row in
each tester's browser. No login screen is involved.

Remove a tester's individual target in LD to deny subsequent availability and
delivery evaluations once the SDK receives the change. Turn the flag off to
deny everyone. Removing/rotating the signing secret invalidates all tester
credentials after the new configuration deploys. `WATCH_FOR_YOU_ENABLED=false`
remains the environment kill switch. Already rendered recommendation cards
are not forcibly removed from an open page; reload to recheck visibility.

## Verification recorded for feat-524

- 76 focused tests cover real token signing, cookie exchange, availability,
  revocation, kill switch, existing account/anonymous targeting, request bounds,
  algorithm/audience/origin checks, and both expiry periods.
- The emitted bridge script runs in a Node VM test for success, network
  rejection, timeout, and missing fragment. This is not a real-browser test.
- The Next development server returned GET 200 (746 bytes), POST 204 with a
  cookie, and private/no-store availability false with no LD SDK configured.
- The added no-cookie validation path took 29.4 ms for 100,000 local calls
  (about 0.0003 ms per call). This is a microbenchmark, not production latency.
- Watch components, page/layout rendering, hydration, and proxy are unchanged;
  ordinary visitors make no new requests or load new client assets.
- Web lint/typecheck passed. Browser smoke was unavailable because no browser
  was connected. Production secret setup, deployment, and live browser checks
  remain feat-525; no production rollout success is claimed here.
