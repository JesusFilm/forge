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
open the link. Links can be reused during 30 days; sessions end 30 days
after link issuance, including repeated activations. Anyone holding a link can
activate that tester's rollout identity during those 30 days. This mechanism
is suitable for feature previews, not authorization to private account data.

This 30-day policy replaces the original 24-hour link and seven-day cookie
limits at the owner's request. Issue replacement links after the new release:
already-issued links and cookies retain their signed expiration. Reopening a
new link refreshes the browser cookie only until that link's original 30-day
deadline. Removing an LD target or turning the flag off still denies access
on the next evaluation; no link or cookie overrides that decision.

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

**State at publication:** Web still had no `LAUNCHDARKLY_SDK_KEY`. LD
production version 6 still enables only the three targets, with false
fallthrough/off. Anonymous availability remains false. Configure the Watch
Production **server** SDK key through the normal secret/deployment path, then
verify all three targeted sessions return true, non-targets remain false, and
the browser shows real recommendation cards. No browser is connected to this
task, so no live browser visibility or hydration claim is made. Keep feat-525
in progress until that end-to-end verification passes.

### Production SDK key staged for deployment

On 2026-09-21, the owner supplied the Watch Production server SDK key. A live
Node SDK initialization succeeded, and the recommendations flag returned true
with `TARGET_MATCH` for each of the three configured tester IDs. A fresh
untargeted tester UUID and `watch-anonymous` both returned false with
`FALLTHROUGH`. Existing CTA-copy and YouVersion flags remained false; absent
download-account, beta-CTA, hide-Bible-quotes, and question-panel flags retained
their false defaults.

The key was saved only as Web production's `LAUNCHDARKLY_SDK_KEY`, using stdin
and `--skip-deploys`. Secret readback matched without printing its value; no
other service variable changed. The signing secret remains configured, the
serving kill switch resolves true, and the public fallback remains false.
The environment example documents all private-pilot prerequisites. PR #2372
merged as `f8f997fc8cb8cb49e5b16e6c460beffb1ad25468`, and Railway deployment
`84d5d314-2e76-4281-9b05-95fede1be528` reached SUCCESS at that revision.

At 22:13 UTC on 2026-09-21, all three live tester activations returned 204 and
availability true. Each delivery returned HTTP 200, `result: served`, six
distinct cards, valid positions, required card fields, and a request ID in
436/778/655 ms respectively. Anonymous availability remained false; a valid
signed but untargeted tester received availability false and delivery 403
`feature_disabled`. The public homepage contained the authored block, and the
activation bridge retained its single nonce-authorized script and
`no-transform`. Browser control was unavailable, so these finite HTTP probes
do not establish visual rendering or broad runtime reliability.

### Real-browser pilot checks — 2026-09-23 UTC

The latest successful Web production deployment was
`9448a080-628d-4964-ae79-81c1f920739e` at
`37e10b622bd66e55647cf561c3896b2d4fbb4dce`. It includes PR #2375's
30-day activation/session policy. Later Web deployment records for unrelated
main commits were `SKIPPED`, not newer running revisions. Production Web has
the dedicated signing secret and Watch Production LaunchDarkly server SDK key.
The canonical origin and `WATCH_FOR_YOU_ENABLED=true` resolve from production
code defaults; they are not explicit service variables. The public fallback
remains false.

In a fresh isolated Chromium session, ordinary `/watch` rendered and a
same-origin availability request returned HTTP 200, `enabled: false`, with
`private, no-store` caching. No recommendation row appeared. The public
activation bridge still returned one script, no Cloudflare beacon, and
`Cache-Control: ... no-transform`. Public `/watch` returned HTTP 200; one
finite curl sample was 0.499 seconds to first byte and 0.657 seconds total
for 867,295 bytes. This is not a population-level loading measurement.

Using the existing production secret privately, Nisal's already-targeted
identity opened a newly issued 30-day activation link in a separate browser.
The bridge redirected to `/watch` and cleared the URL fragment. The browser's
same-origin availability request returned HTTP 200, `enabled: true`. After
scrolling the published `watch-home-recommendations` row into view, the browser
rendered six distinct linked cards with real thumbnails, titles, and durations.
A private visual screenshot confirmed the cards. No link, token, or secret was
saved in repository evidence or sent to another person. Both browser sessions
were closed after the checks.

Vlad and Tataihono then activated separately in one browser session, with
cookies and local/session storage cleared between identities. The cleared
browser returned availability false before the next activation. Each link
redirected to `/watch` with its fragment removed. Each identity returned
availability true and rendered six distinct linked cards with six loaded
thumbnails and durations. In these two finite headless samples, navigation
DOMContentLoaded/load timings were 820/828 ms for Vlad and 560/566 ms for
Tataihono. They do not establish a loading percentile or replace wider Web
performance monitoring.

The Watch Production flag was read at version 6 before the revocation check:
on, exactly the three documented `watch-recommendation-tester` true targets,
no rules, false fallthrough and off variation. A temporary disposable UUID
`f37c355e-d80b-4a0f-beab-b2a962359ab3` was added as a fourth individual
true target at version 7. Its signed browser session returned availability
true and displayed six loaded recommendation cards. Only that UUID was then
removed. Without clearing its signed cookie, the same browser returned
availability HTTP 200 with `enabled: false`; delivery POST returned HTTP 403
`feature_disabled`. Flag readback at version 8 had exactly the original three
targets and unchanged on/rules/fallthrough/off configuration. All owned
browser sessions were closed.

Fresh 30-day links for the same three IDs were subsequently issued to
separate owner-only files under the Git-ignored `.context/private/` directory
of the feat-525 worktree. That directory has mode `0700` and each file has
mode `0600`. Their signed claims and HMAC were checked in memory. All three
expire at 2026-10-23 23:38:31 UTC. The original 24-hour links issued on
2026-09-21 retain their original expiry. No replacement link was delivered
to another person by this task. The owner must privately distribute these
files' links through an approved channel before claiming that the three
people have personally used the pilot. Do not record the links, tokens, or
signing secret in repository evidence.
