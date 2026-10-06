---
date: 2026-10-05
draft_id: "03"
title: "Use historical analytics in model decisions"
status: published
issue_url: https://github.com/JesusFilm/forge/issues/2568
roadmap: feat-590
draft_blocked_by: ["02"]
---

# 03: Use historical analytics in model decisions

## Parent

https://github.com/JesusFilm/forge/issues/2565

## What to build

Allow the offline source-generation workflow to explore authorized historical
GA reports through read-only tools and use qualified aggregate evidence in
recommendation decisions. Admin shows the source coverage and provenance used by
the saved result, including gaps and uncertain historical bot filtering.

GA Data API access to property `320198532` is verified through read-only
impersonation of
`watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com`.
On 2026-10-06 the user approved the first build using validated Watch referrer
links plus engagement, labeled as navigation evidence. This replaces the first
build's requirement to prove consecutive playback of both Videos. Existing
ordered-history inputs retain their stricter semantics.

The new input associates `pageReferrer` with the destination `pagePath` on
`videostarts` aggregates. Both endpoints must map to canonical Watch Videos.
Counts measure destination starts associated with a referrer, not unique
navigations, source playback, or consecutive watched Videos. Do not reconstruct
individual journeys by chaining aggregate associations. Record the mapping
basis and exclude ambiguous, unmapped, homepage, and self-referral pairs.

The user clarified on 2026-10-06 that this property covers all of jesusfilm.org,
but historical recommendation evidence must be limited to `/watch` and
`/watch/**`. Parse the source URL into hostname and pathname, accept only the
verified jesusfilm.org hostname aliases and either exact `/watch` or the
`/watch/` prefix, and exclude query strings/fragments from path matching. Do
not include `/watching` or unrelated site pages. Missing or malformed URLs
and excluded host/path coverage must remain explicit. Both navigation endpoints
must be within Watch. For legacy ordered-history inputs, scope filtering must
not erase intervening non-Watch starts and fabricate a direct transition.

## Acceptance criteria

- [ ] Source discovery verifies the provider, schema, history, and Video identifier mapping once authorized access is available. Without it, the operation reports unavailable input rather than a successful history-backed build.
- [ ] Authentication stays server-side and tools are read-only. Keys, credentials, and individual viewer identities do not enter model prompts or saved recommendation output.
- [ ] The model can inspect definitions and the full requested historical range through bounded/paginated responses. A provider-declared availability boundary may establish a separately recorded usable interval. The unavailable prefix and gaps remain unknown; completed processing of a usable snapshot never implies complete source history. Arbitrary short lookbacks, partial pagination, sampling, and unresolved response restrictions cannot silently qualify a build.
- [ ] All historical engagement, exposure, and navigation evidence is restricted to verified jesusfilm.org `/watch` or `/watch/**` paths. Tests cover `/watch`, nested paths, query/fragment handling, `/watching`, unrelated hosts/pages, missing or malformed URLs, homepage/self-referrals, and ambiguous mappings. Legacy ordered-history tests continue to cover non-Watch intermediate starts. Saved provenance includes the versioned host/path filter and known scope coverage; unavailable exclusion counts remain unknown.
- [ ] Source-computed engagement and referrer aggregates feed the actual model-to-Admin workflow. Validated IDs/URLs map to canonical Videos with a stated mapping basis; unknown mappings are reported rather than guessed. Navigation is explicitly distinct from consecutive playback, unique navigation counts, and viewer journeys.
- [ ] The model can weigh content and analytics while still requiring an explainable connection. Lack of exposure is not treated as evidence of poor quality.
- [ ] Native and warehouse evidence retain separate provenance and are not double-counted. Unknown historic bot filtering is labeled unknown, while live A/B eligibility retains its separate policy.
- [ ] Saved build metadata includes query/range/cutoff, result hashes/counts, measurement qualification, mapping coverage, and query usage/cost qualification without storing raw user-level warehouse rows.
- [ ] Adapter and build-to-review tests cover missing access, schema/mapping gaps, pagination, zero metrics, missing exposure, overlapping evidence, and read-only enforcement.
- [ ] No BigQuery export, write identity, destination dataset, export outbox, or new analytics database is introduced.

## Implementation context

Server-side GA access is verified; canonical mapping and a live qualified
model-to-Admin smoke remain required. GA reports identify a custom-dimension
availability boundary after 2022-08-05. Preserve the original requested range,
declare the usable interval separately, and retain that missing prefix in
provenance. Do not hide missing live acceptance behind fixtures or label unknown
bot filtering, exposure, overlap, or API query cost as zero. Reuse the dedicated
read-only service-account path without assuming SEO credentials authorize it.

## Blocked by

- #2567

## Execution policy

The user approved this ticket breakdown and the parent spec's testing boundaries.
Use GPT-6 Sol development chats and Matt Pocock's implement, tdd, and code-review
skills. Do not invoke Compound Engineering skills, directly or through another
skill; this explicit user instruction overrides that default repository workflow.
Follow the other repository conventions. Development-chat Sol does not replace
the product's Astra model. Work under the orchestrator's integration branch;
public activation remains a separate explicit operation.
