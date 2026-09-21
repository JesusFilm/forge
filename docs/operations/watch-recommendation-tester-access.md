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
private channel. Links were issued privately in the owner task on 2026-09-21;
none were emailed or sent to teammates by this task.

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

The bridge's HTML response also sets `no-transform` so the public edge does
not append an analytics script. Verify the response through the public domain:
origin-only tests cannot prove the edge leaves the HTML unchanged.

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

## Production activation progress — 2026-09-21

PR #2358 merged as `a569db9740caa7388be858fea9526dfd995f274d` and Railway
deployment `29f2b090-7deb-4bdb-baa6-56799c38318b` succeeded. The dedicated
signing secret was provisioned before this normal deployment. The first live
probe found Cloudflare adding its beacon to the otherwise isolated bridge;
the scoped `no-transform` fix subsequently shipped in PR #2361, merge
`ec6bf167175cd3c4f13969edc73521459513325e`, deployment
`461a48c0-1c71-4063-ae01-e2551b5c8753` (SUCCESS). The public activation HTML
contained exactly one script with the matching CSP nonce and `no-transform`.
All three HTTP activation probes returned 204 with the expected cookie; wrong
origin and invalid credentials returned 403. This proves the HTTP exchange,
not a browser-rendered recommendation row.

The initial links did not reveal recommendations: Web production had no
`LAUNCHDARKLY_SDK_KEY`, and the published homepage had no
`HomepageRecommendationsBlock`. A successful cookie exchange did not complete
the pilot. Do not issue replacement links as a substitute for fixing those
dependencies.

### English homepage restored at 21:02 UTC

On 2026-09-21 at `21:02:14.503Z` (22 September in New Zealand), the existing
Admin `ExperienceService.updateLocaleDraft` and `publishLocale` restored one
block to locale `cmr96r2y10001p08tkp2bcrqu`. It is immediately after the category
rail, index 2, with `sectionKey: watch-home-recommendations` and the default
localized heading. The homepage now has 14 blocks. All 13 prior blocks and
locale metadata were preserved exactly; schema normalization changed nothing.

The operation used Nisal's existing Admin principal. No unpublished draft
existed. Staging checked that the canonical revision was unchanged, and
publication rechecked canonical content and the exact draft revision while
holding the locale row lock. The prior canonical snapshot remains in historical
revision `cmubqe2g80001q8mld7in7o5v`; applied draft
`cmubqe2ec0000q8mle5bkhgke` is historical and no active draft remains. Route
manifest regeneration completed. No application deployment was triggered.

Admin's configured legacy-host webhook returned HTTP 405. An authenticated
POST to the canonical `https://www.jesusfilm.org/watch/api/revalidate` returned
200 with `revalidated: true`; follow-up feat-531 owns the persistent endpoint
configuration repair. Public Admin GraphQL now returns exactly one
`HomepageRecommendationsBlock` at index 2. The public Watch HTML contains that
block and section key.

Two finite HTTP samples before publication were 321/286 ms and 866,315 bytes;
after revalidation they were 283/237 ms and 867,594 bytes, both HTTP 200 with
Next cache HIT. The HTML increase is 1,279 bytes. These samples do not establish
browser hydration or rendering performance. Restoring the authored component
also restores its existing client-side availability request.

**Pilot remains incomplete:** Web still has no `LAUNCHDARKLY_SDK_KEY`. LD
production version 6 still enables only the three targets, with false
fallthrough/off. Anonymous availability remains false. Configure the Watch
Production **server** SDK key through the normal secret/deployment path, then
verify all three targeted sessions return true, non-targets remain false, and
the browser shows real recommendation cards. No browser is connected to this
task, so no live browser visibility or hydration claim is made. Keep feat-525
in progress until that end-to-end verification passes.
