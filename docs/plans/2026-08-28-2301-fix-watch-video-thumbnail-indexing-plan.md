---
title: "Watch Video Thumbnail Indexing - Plan"
type: fix
date: "2026-08-28"
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Watch Video Thumbnail Indexing - Plan

## Goal Capsule

- **Objective:** Google can consistently identify and index the primary video on canonical Watch pages without crawler requests increasing Forge Web saturation.
- **Means:** Publish crawler-eligible, stable video metadata and serve provider-sized Watch images without a second Forge transformation.
- **Product authority:** Requirements define crawler-visible behavior; implementation details remain subordinate to them.
- **Open blockers:** Search Console recrawl timing cannot gate the PR. Mux or Cloudflare account changes require separate owner confirmation before they become implementation dependencies.

---

## Product Contract

### Summary

Canonical Watch pages will advertise a stable thumbnail and a fetchable player that search crawlers are allowed to index. Watch image delivery will avoid redundant Forge transformations for images that Mux or Cloudflare already size, while preserving responsive layout and visual quality.

### Problem Frame

Search Console reported `Thumbnail could not be crawled due to hostload` and `Thumbnail could not be reached` on 2026-07-27. The canonical JESUS page is indexed and exposes one valid `VideoObject`, but Search Console reports no indexed video.

The July errors coincide with FGE-61's production evidence: uncached `/_next/image` work fetched already-sized provider images, re-encoded them in Forge Web, and returned image 500s while the Node process was CPU and event-loop saturated. A later live probe shows the hostload burst has recovered, but both the current Mux thumbnail and HLS URLs still return `X-Robots-Tag: noindex, nofollow` to Googlebot. The canonical page already has a curated Cloudflare Images poster that returns 200 without that exclusion.

### Key Decisions

- **Use an existing editorial media image as the structured thumbnail when one is available.** This preserves video identity without coupling structured data to the promotional social-image overlay. Governs R1-R3.
- **Use a supported player URL when Mux's content bytes exclude crawlers.** A valid video item is insufficient if every advertised media URL tells Google not to index it. Governs R4-R6.
- **Do not proxy crawler thumbnails through Forge Web.** A same-origin proxy would recreate the outbound fetch and Node load that FGE-61 is intended to remove. Governs R7-R9.

### Actors

- **Search crawler:** fetches a canonical Watch page, its declared thumbnail, and a usable video player or media URL.
- **Viewer:** receives the same visual Watch experience and stable canonical page after the metadata and delivery changes.
- **Watch operator:** distinguishes provider reachability, Cloudflare policy, Forge transformation, and crawler recrawl state during verification.

### Requirements

**Crawler-visible video identity**

- R1. Each eligible Watch `VideoObject` uses one unique, stable HTTPS thumbnail URL for the selected video.
- R2. A declared thumbnail returns an image success response to Googlebot without a `noindex` or `noimageindex` directive.
- R3. Editorial video artwork outranks a generated provider frame; promotional social-image overrides do not redefine the structured video identity.
- R4. Each eligible Watch `VideoObject` provides at least one crawler-usable video location through `contentUrl` or `embedUrl`.
- R5. A media URL carrying `X-Robots-Tag: noindex` is not advertised as crawler-usable content.
- R6. Noindex pages and records lacking truthful required fields continue to suppress `VideoObject` markup.

**Image delivery resilience**

- R7. Mux and Cloudflare images already requested at a final bounded size do not require a Forge `/_next/image` fetch and re-encode.
- R8. Bypassing Forge transformation preserves the rendered aspect ratio, responsive layout, image quality, lazy/eager loading intent, blur placeholders, and the single LCP poster preload.
- R9. Cloudflare protections are changed only for exact image paths and cache keys needed by Watch; no broad crawler or WAF bypass is introduced.

**Evidence and operations**

- R10. Automated probes classify page markup, thumbnail response, player or content response, and Forge image transformation as separate gates.
- R11. A bounded crawler/image load test produces no image 5xx or outbound TCP timeout and keeps sustained event-loop utilization below 0.90.
- R12. Search Console validation is requested after release, but success is evaluated only after the inspected URL's last crawl is later than the deployment.
- R13. Pre- and post-release video-indexing counts, affected reasons, inspected canonical, declared thumbnail, last crawl, and validation date are recorded.

### Key Flows

1. Web resolves the selected Watch video and its canonical media identity.
2. Server-rendered JSON-LD selects a crawler-eligible editorial thumbnail and a supported video player or eligible content URL.
3. The crawler fetches the page and declared resources directly; its path does not require Forge to fetch and transform the provider thumbnail.
4. Automated probes report which layer failed before Search Console is asked to validate the fix.
5. After deployment and recrawl, the operator compares the canonical page's video-indexing state with the recorded baseline.

### Acceptance Examples

- **JESUS canonical:** `/watch/jesus.html` emits exactly one `VideoObject`; its thumbnail is the existing JESUS editorial image, returns 200 to Googlebot, and carries no indexing exclusion; its player or content location is fetchable without a `noindex` response.
- **Mux-only record:** a playable video without editorial artwork does not silently claim that an excluded Mux thumbnail is crawler-eligible. The implementation either supplies an approved indexable fallback or fails closed and reports the missing prerequisite.
- **Contextual identity:** a contextual episode and its standalone canonical page keep the same primary video identity, thumbnail identity, and player/content identity.
- **Visual preservation:** representative mobile and desktop Watch pages retain their poster crop, dimensions, blur transition, lazy carousel loading, and zero unexpected layout shift.
- **Failure isolation:** a forced provider failure is reported as provider reachability; a forced Forge optimizer failure is reported separately and does not affect the new crawler thumbnail path.

### Success Criteria

- Repeated Googlebot-style requests to representative declared thumbnails and players/content return successful responses with no crawler exclusion.
- The controlled FGE-61 image load test meets R11 without increasing Railway memory as a workaround.
- After an eligible recrawl, Search Console no longer reports thumbnail reachability or hostload for the canonical JESUS page and recognizes its video.
- No regression appears in Watch LCP, CLS, responsive image quality, canonical metadata, Open Graph, or Twitter previews.

### Scope Boundaries

- This work does not weaken Cloudflare protections globally.
- This work does not make a Next route an image origin or add a Node image proxy.
- This work does not use the editor-owned social-image overlay as structured video identity.
- This work does not change canonical Watch URL policy, visible video titles, playback behavior, or Mux Data attribution.
- This work does not treat a Rich Results Test pass or a same-day Search Console state as proof that Google indexed the video.

#### Deferred to Follow-Up Work

- A paid Mux custom delivery domain and Cloudflare response-header policy may provide a broader first-party media origin, but it is not required for the smallest code fix.
- Full removal of optional subtitle VTT work from server rendering remains part of the wider FGE-61 incident follow-up, not this thumbnail-indexing slice.

### Assumptions

- The existing Cloudflare Images editorial poster URLs are stable media identity URLs rather than expiring signed URLs.
- `player.mux.com/{playbackId}` remains Mux's supported public embed contract for public playback IDs.
- Search Console's current `No video indexed` state may have more than one cause; the plan must fix both the excluded thumbnail and excluded Mux HLS signal rather than assume the alert text is exhaustive.

### Open Questions

All are deferred to planning or post-release operations; none changes the required user-facing behavior.

- **Deferred to Planning:** Which Watch image call sites belong in the first bounded provider-bypass slice while still meeting FGE-61's representative journey criteria?
- **Deferred to Planning:** For Mux-only videos without editorial artwork, is an already-configured first-party/custom Mux domain available, or must those pages fail closed until an indexable poster is ingested?
- **Deferred to Planning:** Which Datadog synthetic and load-test environment can exercise production-equivalent CPU and replica limits without impacting users?

### Sources

- `docs/roadmap/topic-experiences/feat-440-watch-video-thumbnail-indexing.md`
- Linear FGE-61, `[P1][Postmortem] Prevent recurrence of Watch image/media TCP timeouts and Node saturation`
- `apps/web/src/lib/experience-metadata.ts`
- `apps/web/src/lib/watch-structured-data.ts`
- `apps/web/src/lib/url.ts`
- `apps/web/src/lib/watch-url-probe.ts`
- `apps/web/src/components/watch/HeroPlayer.tsx`
- `apps/web/src/components/watch/SiblingCarousel.tsx`
- `docs/solutions/architecture-patterns/watch-video-search-social-metadata-overlay.md`
- `docs/solutions/performance-issues/web-watch-route-lighthouse-perf-campaign-lcp-bundle-fonts-20260527.md`
- Google Search Central, `VideoObject` structured data, Video SEO best practices, and robots meta/X-Robots-Tag specifications
- Mux, thumbnail/image delivery, player embed, and custom delivery-domain documentation

---

## Planning Contract

The Product Contract above is preserved unchanged. This implementation plan is subordinate to R1-R13 and does not broaden the roadmap ticket.

### Approach

Ship one bounded Web PR with three independently testable layers:

1. Correct the server-rendered `VideoObject`: select editorial Cloudflare artwork before generated Mux frames, publish Mux's supported public player as `embedUrl`, and omit a Mux HLS `contentUrl` that is known to return `X-Robots-Tag: noindex`.
2. Remove the redundant Forge transformation from provider-sized Watch thumbnails with one pure provider-URL loader and a bounded migration of the high-traffic Watch, search, and collection card call sites. The helper must preserve provider transforms, aspect ratio, and the existing Next `sizes` contract; it must not introduce a same-origin proxy.
3. Extend the existing Watch probe so markup identity, declared-resource reachability/robots policy, and Forge-transform use are observable as separate gates.

This is preferred to waiting for recrawl because the exclusion headers persist, and to a same-origin image route because that recreates the FGE-61 outbound-fetch failure mode. A Mux custom delivery domain is intentionally deferred because it is an account/commercial dependency and is unnecessary for the JESUS page.

### Implementation Units

#### IU1 — Crawler-eligible media identity

**Files**

- `apps/web/src/lib/experience-metadata.ts`
- `apps/web/src/lib/experience-metadata.test.ts`
- `apps/web/src/lib/__tests__/experience-metadata-watch-page.test.ts`
- `apps/web/src/lib/watch-structured-data.ts`
- `apps/web/src/lib/watch-structured-data.test.ts`
- `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`

**Changes**

- Extend `WatchVideoMetadataModel` with an optional structured-data `embedUrl` and separate the playable HLS value from the URL advertised to crawlers. Derive `https://player.mux.com/{playbackId}` only from a non-empty public Mux playback ID.
- Resolve `structuredDataThumbnailUrl` from the existing editorial chain without passing the Mux playback fallback. Keep the promotional `socialImage` overlay and Open Graph/Twitter image selection unchanged. If no editorial thumbnail exists, return `null`; do not silently fall back to the excluded `image.mux.com` URL.
- In `watchVideoStructuredDataJson`, accept either a validated stable HTTPS `contentUrl` or validated HTTPS `embedUrl`, emit only the eligible values, and keep all existing required-field/noindex gates. For the current Mux model emit `embedUrl` and omit its `stream.mux.com` HLS URL. Preserve eligible non-Mux stable content URLs.
- Keep canonical `url`, title, description, upload date, duration, captions, language, and `SeekToAction` behavior unchanged.

**Tests**

- Editorial artwork wins over a Mux frame for JSON-LD while managed social artwork affects social metadata only.
- A public Mux record emits `embedUrl` without its excluded HLS `contentUrl`.
- A non-Mux stable HLS record continues to emit `contentUrl`.
- Missing editorial art on a Mux-only record fails closed; invalid/signed/non-HTTPS embed or content URLs cannot make a record eligible.
- The canonical and contextual route fixtures emit the same primary name, thumbnail, and player/content identity and exactly one `VideoObject`.

#### IU2 — Direct provider image delivery

**Files**

- `apps/web/src/lib/provider-image-loader.ts` (new)
- `apps/web/src/lib/provider-image-loader.test.ts` (new)
- `apps/web/src/components/watch/SiblingCarousel.tsx`
- `apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx`
- `apps/web/src/components/search/VideoCard.tsx`
- `apps/web/src/components/search/VideoCard.test.tsx`
- `apps/web/src/components/home/WatchHomeCard.tsx`
- `apps/web/src/components/sections/MediaCollection.tsx`
- `apps/web/src/components/sections/MediaCollection.test.tsx`

**Changes**

- Add a pure Next image loader for `image.mux.com` and `imagedelivery.net`. It returns the provider URL directly, changes only provider-supported width/quality transforms, scales an existing paired height with width to preserve aspect ratio, retains Mux `time`/`fit_mode` and Cloudflare format/quality parameters, and falls back to Next's normal path for every other host.
- Apply the loader only when the resolved source is on one of those two allowlisted hosts. Preserve every call site's current `fill`, `sizes`, priority/loading, blur placeholder, class, object positioning, hover preview, and alt text.
- Cover the representative high-traffic sources named by FGE-61: episode siblings, Watch home rails, Watch media collections, and Watch search results. Leave `HeroPlayer`'s existing provider-aware poster loader/preload contract intact.
- Assert rendered `src`/`srcset` values point to the provider and never to `/_next/image` for allowlisted provider URLs; assert an unrelated remote/local image still uses normal Next behavior.

#### IU3 — Probe and operational evidence

**Files**

- `apps/web/src/lib/watch-url-probe.ts`
- `apps/web/src/lib/watch-url-probe.test.ts`
- `apps/web/scripts/probe-watch-urls.ts`
- `docs/qa/watch-video-thumbnail-indexing-2026-08.md` (new evidence template, completed during release verification)

**Changes**

- Parse `thumbnailUrl` and `embedUrl` as part of `VideoObjectIdentity`; compare contextual and standalone thumbnail plus player/content identities in addition to name.
- Fetch declared thumbnail and player/content URLs with a Googlebot-style user agent. Record status, content type, final URL, timeout, and normalized `X-Robots-Tag`; fail the crawler gate for non-success responses, redirects to an excluded URL, `noindex`, or `noimageindex` where applicable. Validate response type by declared field: `thumbnailUrl` requires an image MIME type, `embedUrl` requires HTML, and `contentUrl` requires an accepted video or HLS MIME type. Cover each 200-with-wrong-type path in probe tests.
- Report whether representative rendered provider images use a direct provider URL or Forge `/_next/image`; do not collapse that result into resource reachability.
- Keep external resource probes bounded with explicit timeouts and a small concurrency limit so the diagnostic itself cannot recreate the incident.

### Dependency Order

1. IU1 establishes the truthful crawler contract and can be reviewed independently.
2. IU2 can proceed in parallel after the loader API is fixed; its UI call-site work does not alter JSON-LD.
3. IU3 consumes IU1's final fields and verifies IU2's delivery invariant, so land it after both implementations are stable.

No schema generation, Admin GraphQL change, migration, feature flag, or infrastructure change is required.

### Product Contract Question Resolutions

- The first provider-bypass slice is resolved by IU2: episode siblings, Watch home rails, Watch media collections, and Watch search results; `HeroPlayer` retains its existing provider-aware contract.
- The Mux-only fallback is resolved by IU1: records without an indexable editorial poster fail closed until an approved indexable poster or delivery origin exists.
- The production-equivalent load-test target and monitoring owner remain the only unresolved prerequisite, and must be assigned before merge.

### Verification Contract

**Automated, before PR**

```bash
pnpm --filter web exec vitest run \
  src/lib/experience-metadata.test.ts \
  src/lib/__tests__/experience-metadata-watch-page.test.ts \
  src/lib/watch-structured-data.test.ts \
  src/lib/provider-image-loader.test.ts \
  src/lib/watch-url-probe.test.ts \
  src/components/watch/__tests__/SiblingCarousel.test.tsx \
  src/components/search/VideoCard.test.tsx \
  src/components/sections/MediaCollection.test.tsx \
  'src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx'
pnpm --filter web typecheck
pnpm --filter web lint
pnpm prettier --check docs/plans/2026-08-28-2301-fix-watch-video-thumbnail-indexing-plan.md
```

Run the normal PR-focused checks for `apps/web` as required by the repo guide. Record any pre-existing unrelated failures rather than weakening the assertions.

**Browser/performance, before merge**

- Test `/watch/jesus.html`, one contextual episode, Watch home, and Watch search at phone and desktop widths. Confirm poster crop, blur, carousel lazy loading, hover preview, and no new CLS.
- Inspect Network: migrated Mux/Cloudflare card images must request their provider origin directly; no corresponding `/_next/image` request may reach Forge. The hero retains exactly one poster preload.
- Compare mobile/desktop LCP and CLS with the current baseline; reject a measurable regression outside normal run variance.
- Run a 30-minute production-equivalent crawler/image test against representative provider URLs and pages. Require zero image 5xx/outbound TCP timeout, sustained event-loop utilization below 0.90, and no rising saturation trend. This evidence is a release gate even though the environment/Datadog owner is operationally assigned outside the code diff.

**Production verification**

- Before deploy, record Search Console video-indexing counts/reasons and URL Inspection for the canonical JESUS page in the QA document.
- After the normal PR-to-main deployment, run the extended probe against JESUS and representative contextual/standalone pages. Verify declared thumbnail and player return success, correct media type, and no crawler exclusion; verify provider images bypass Forge transforms.
- Request Search Console validation/recrawl. Re-check only after `last crawl` is later than the deployment; record the dates and declared URLs. Do not roll back solely because Google has not recrawled yet.
- Observe Datadog/Railway for 24 hours: image 5xx, outbound TCP timeout, CPU, event-loop utilization, RSS, and requests to `/_next/image` for provider origins.

### Rollout and Rollback

- Roll out through the normal PR-to-main path. No direct Railway deploy is permitted.
- The metadata change is fail-closed and does not require a runtime flag. The image-loader migration is call-site bounded, so it can be reverted independently if image quality, provider quota, or caching regresses.
- Roll back the affected IU if provider requests fail, visual/LCP/CLS regression is confirmed, JSON-LD loses required fields, or Forge saturation worsens. A stale Search Console state before an eligible recrawl is not a rollback trigger.
- If Cloudflare blocks the exact declared editorial image, first confirm the exact path/cache key and make only a narrowly reviewed edge-policy adjustment; never add a global Googlebot/WAF bypass.

### Risks and Mitigations

- **Mux headers can change:** probe response headers in production and retain the fail-closed rule; do not hard-code a claim that every Mux resource is indexable.
- **Editorial artwork may be absent or malformed:** suppress `VideoObject` for that record and report the prerequisite instead of publishing a false thumbnail. A durable fallback/custom domain is follow-up scope.
- **Provider loaders can distort images:** scale paired width/height transforms together and assert representative URL outputs plus visual crops.
- **Direct delivery can change cache/quota economics:** measure provider cache headers/request volume during the bounded rollout; the rollback is isolated to IU2.
- **Crawler and viewer paths can diverge:** use the same server-rendered URLs for all user agents and test only policy/reachability with the crawler header; do not add crawler-specific rendering.
- **Search Console is eventual:** tie acceptance to post-deploy crawl timestamps and keep deterministic probes/load tests as the immediate release evidence.

### Definition of Done

- [ ] IU1-IU3 tests and all `apps/web` PR checks pass.
- [ ] Metadata tests plus the extended probe establish R1-R7 and R10 for JESUS and representative contextual/standalone pages.
- [ ] Browser/performance evidence establishes R8; R9 is established by confirming no edge-policy change occurred or, if one was necessary, by recording the exact-path policy review.
- [ ] Migrated provider images bypass Forge without visual, LCP, or CLS regression.
- [ ] The production-equivalent load test meets R11, and 24-hour production monitoring shows no recurrence.
- [ ] Baseline, deployment, probe, Search Console request, eligible recrawl, and final state are recorded in the QA artifact.
- [ ] The PR may merge after deterministic release gates pass, but the roadmap ticket remains `in-progress` until an eligible post-deployment crawl is evaluated and the R13 evidence and final state are recorded.

### PR-Readiness Blockers

- The code plan has no account-level prerequisite for the canonical JESUS fix.
- The PR author must identify the production-equivalent load-test target and monitoring owner before merge; do not run the saturation test against live users.
- Mux-only records without editorial art remain intentionally ineligible until an indexable poster or approved custom delivery origin exists. This does not block JESUS, but it blocks claiming universal video eligibility.
