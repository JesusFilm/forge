# Source-free user recommendations

The shared Admin API returns one ranked list without a seed video. Web renders
six cards through the authored `HomepageRecommendationsBlock`, labeled
“Recommended for You.” The homepage starter places it after Browse by category;
editors can reorder or remove it through the normal Experience Editor. It is a
top-level singleton with `t: "homepageRecommendations"`, optional `sectionKey`, and
optional `title`. A blank title uses the localized default. Its block payload
contains no viewer profile or personalized results. Delivery is deferred until the
row approaches the viewport. It refreshes on a new homepage visit, reload,
bfcache restoration, language change or profile change; ordinary focus and
visibility changes leave the cards stable.

## Client contract

Use authenticated **POST** requests to Admin `/api/graphql`. The existing Web
consumer bearer serves the Web backend; native clients use their configured
fleet consumer bearer. A fleet key identifies the application, not the viewer.
Shared typed operations and operation strings are exported from
`@forge/admin-graphql/operations`. Do not put credentials in URLs or telemetry.

1. Call `adminCreateRecommendationViewerOperation` once per installation. Store
   the returned `viewerToken` locally in platform secure storage. Retain the
   separate `sessionToken` through playback and navigation. The server stores
   only digests and resolves its own profile; clients never upload a profile.
2. Call `adminUserRecommendationsOperation` with `viewerToken`, `sessionToken`,
   `locale`, `audioLanguageSlug`, and optional `count` (integer 1–20, default 6).
   The response uses `user-recommendation-v1` and `watch-for-you-v1`. The latter
   names the recommendation surface contract and imposes no cookie requirement.
3. Render in returned `position` order. Keep capabilities in memory. Record
   `render` and eligible `impression` facts with
   `adminRecordSemanticRecommendationEvidenceOperation`; payloads are
   `{surfacePolicy: "watch-for-you-v1"}` and
   `{visibilityPolicy: "watch-for-you-v1"}`. Web qualifies an impression after
   50% visibility for one continuous second.
4. Select using `adminSelectSemanticRecommendationOperation` and a fresh random
   `claimNonce` (at least 16 characters). Open `canonicalHref`, the complete
   video; no scene seek is attached. Claim with
   `adminClaimSemanticRecommendationEpisodeOperation`, the same identity,
   nonce, and `targetMediaId` as `mediaId`.
5. Submit playback using `adminRecordSemanticRecommendationPlaybackOperation`
   and the **episode** capability. Reuse an event ID only for identical retries.
   Direct/search/editorial playback first obtains a context through
   `adminIssueWatchPlaybackContextOperation` and then claims it in the same way.
   All six shared evidence/context/selection/playback/content-action operations
   accept native viewer/session tokens or the trusted Web session digest.

Example delivery variables (opaque values omitted):

```json
{
  "viewerToken": "<stored viewer token>",
  "sessionToken": "<current session token>",
  "locale": "en",
  "audioLanguageSlug": "french",
  "count": 6
}
```

UI locale and audio language are independent. This example requests English
metadata and French playback and needs a pool validated for that exact context.
It never substitutes English audio for missing French audio.

Native clients generate a new cryptographically random 32-byte base64url session
token after 24 hours of inactivity; call viewer `status` before playback to link
that session to the same installation. Delivery also authorizes and links it.
Do not rotate mid-playback. Viewer handles expire after 180 days; an expired or
lost handle requires a new bootstrap. This is intentionally independent across
installations, including installations owned by the same person. Account linking
is out of scope; the handle-to-profile adapter is the future extension point.

`adminUpdateRecommendationViewerOperation` accepts `status`, `reset`, `withdraw`,
`grant`, or `delete`. Reset fences old history and creates a new profile while
keeping the installation handle usable. Withdraw/delete preserve an essential
state; status never silently grants personalization again. Existing receipt and
privacy-generation controls remain internal implementation machinery. Web keeps
its existing automatic bootstrap, cookie adapter and settings, with no new
consent prompt. Mixed token and session-digest authority is rejected, and fleet
callers cannot supply raw profile/session digests.

## Ranking and feedback

After current eligibility, canonical deduplication and history rules, profile
candidates fill first. Six profile results cause **no curated query**; four keep
their positions and receive two curated additions; cold starts get six starters.
Qualified history or surviving profile candidates can identify matching editorial
interest pools. Those pools precede `start` only within the missing positions.
No semantic score or scene match is invented for curated content.

History covers up to 24 qualified videos within seven days, from at most eight
authorized profile sessions and 32 finalized episodes per session. Completed
videos and Core-prefix variants are excluded; partial videos move behind unwatched
videos within their own candidate source. Unqualified, conflicted, late,
superseded, expired or profile-ineligible outcomes do not become history.

The existing active-watch classifier, eligibility reconciler and profile
projection jobs process playback. One useful qualified outcome can form a
profile interest; no minimum watch-count gate was added. Only committed, current
projections influence retrieval. A homepage visit before asynchronous projection
finishes can still use curated candidates. Click-only session interests do not
start personalization on this surface; a qualified-watch interest is required.
Inspect existing playback operations
for the full strict event schemas; `playback_attempt` uses `{initiation:"manual"}`,
not a playback-position payload.

Delivery reserves 1,500 ms for Admin, including issuance. Web's Admin call is
bounded at 1,900 ms and browser delivery at 2,200 ms. One delayed retry after five
seconds handles `cooldown`/`in_flight`. A coverage/service failure produces an
explicit unavailable response and a restrained retry state, without affecting
other homepage content. The API never silently returns a normal undersized list,
wrong-language content or completed-video repeats to manufacture six cards.

## Curation, rollout and rollback

The editorial pass lives in `docs/recommendations/curation/2026-09-10/`. It has
start pools and five interest themes; there is **no monthly job or model API
cost**. Future popularity-based updates can create another version through the
same validator/importer.

Migration 0082 makes a source-free request explicit (`purpose='user'`, null seed)
and adds opaque installation handles. Migration 0083 adds sealed curated
generations, pools, memberships and the dedicated active pointer. Deploy the
migrations and regenerated Admin SDL/client artifacts together through the normal
PR-to-main flow. Deploy the Admin block schema before Web's new Experience
fragment, then add/publish the block through the editor or MCP after all Admin
instances accept the new discriminator. Do not backfill Experience JSON in a
pre-deploy database migration. Existing seeded requests default to `purpose='seeded'`.

Flags default off: Admin `RECOMMENDATION_USER_SERVING_ENABLED`, Web
`WATCH_FOR_YOU_ENABLED`. Admin also needs the existing semantic serving control,
active manifest, signer and healthy retention. This reuses operational controls;
user delivery has its own strategy/surface and no experiment assignment. Disabling
the Web flag removes the row; disabling Admin user serving stops new user slates
without changing seeded serving. Do not remove lifecycle support while issued
capabilities are still live.

Use `apps/admin/scripts/import-recommendation-pools.ts` with an explicitly selected
database. `audit` is read-only; `import --execute` seals a passing generation;
`promote --execute --version=... --expected-active=...` moves the pointer; `rollback
--execute --expected-active=...` restores the previous generation after revalidation.
The [initial preview report](../recommendations/curation/2026-09-10/admin-coverage-report.md)
contains import commands and manifests; the
[exhaustive coverage report](../recommendations/curation/2026-09-10/all-context-coverage-report.md)
records every supported locale/audio context. Promotion cannot bypass coverage
checks and never deploys application code.

The local preview activates three contexts only: en/English, fr/French, hi/Hindi.
The complete local audit checks 225 UI locales × 2,317 audio languages. Through
Web's actual homepage locale mapping, 2,081 audio contexts have six curated
starters and 2,073 have thirty (six plus a 24-video exclusion reserve). Of the
236 contexts below six, 200 lack matching published display translations, 35
have insufficient all-catalog inventory, and Arabic Najdi needs additional
editorial choices. Another eight contexts supply six but lack the thirty-video
reserve. Additional overlapping pools cannot repair absent translations or dubs.

All eleven flagged choices received metadata reviews and remain excluded. Live
link checks passed for all 233 referenced English manifests and selected images;
these do not establish all-dub playback or current production publication.
Current production eligibility, the full production build and CI, production pool
import/activation, and rollout verification remain outstanding. A release limited
to passing contexts would require an explicit scope decision and context gating;
the current Web flag is global and an unavailable delivery shows a retry state.
The original all-language six-card requirement is not yet met. Count 20 requires
a larger reserve and is not guaranteed in every language. Missing translations
for the row label remain tracked in the existing UI translation policy.

## Post-Deploy Monitoring & Validation

Release owner: feature owner and recommendation operator. After a normal staged
activation, inspect the first hour and the following 24 hours, then assess
qualified viewing over a seven-day observation window. These are proposed rollout
checks; this task has made no production deployment or analytics claims.

- Search Admin logs for `recommendation.user_delivery`; group result/reason,
  cohort, profile/curated counts and duration. No viewer, session, capability or
  raw profile is logged. Watch `coverage_unavailable`, `delivery_timeout`, and
  `service_unavailable`, plus existing `recommendation.evidence` acceptance and
  playback/projection reconciliation health.
- Confirm user request roots have a null seed, six ordered Web items, source
  provenance and a delivery audit. Separate `cold_start` from `returning`; the
  latter means useful profile/history evidence existed, not a known account.
- Measure distinct displayed requests leading to a current, eligible qualified
  episode. Count impressions, selected items, claimed episodes and qualified
  episodes separately. Use selection-to-episode lineage and the latest outcome
  revision/eligibility decision; a click or delivery alone is not a useful view.
- Roll back the active curated pointer on eligibility/ranking regression. Disable
  Web/user serving on sustained failure, broken playback/learning or coverage
  errors in an activated context. Preserve existing seeded playback and repair
  jobs. Investigate every known inventory failure before widening scope.

See the colocated [validation record](user-recommendations-validation-2026-09-10.md)
for local verification and the retained production activation gates.
