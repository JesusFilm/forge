# Editorial related-video recommendations

Review draft dated 19 October 2026: **1,031 source videos, six ordered choices
each, 6,186 links**. This PR stores content decisions for review; merging it does
not import them into Admin or change production recommendation behavior.

An explicit operator import is documented in the
[import runbook](../../operations/editorial-recommendation-import.md). It uses
the existing saved-generation contract and records rejected/unresolved choices
as gaps; the original editorial list here remains the full review artifact.
Importing a separate generation does not activate an A/B experiment.

- [CSV list](recommendations.csv): one row per source/target connection.
- [JSON list](recommendations.json): ordered choices with canonical IDs, titles,
  reasons, decision method, and evidence flags. This is the authoritative copy.
- [Searchable review page](review.html): download and open locally, or serve this
  directory with `python3 -m http.server 8765 --bind 127.0.0.1` and open
  `http://127.0.0.1:8765/review.html`.
- [Validation report](validation.json) and [playback snapshot](availability.json).

## Basis and limitations

The selections use English catalogue descriptions and existing AI-generated
profiles from `production-astra-catalog-20261013-v6`. Full videos were not viewed.
262 sources have individually tailored sets; 769 use shared editorial decisions
across related content, organized into 82 thematic groups. There are 574 distinct
ordered sets and 518 distinct target videos. These are editorial draft choices,
not measured evidence of viewer preference or usefulness.

172 sources had no profile despite its ready state, and 57 had uninformative
transcript profiles; catalogue descriptions supplied the evidence in those cases.
Five sources carry `title-profile-mismatch-or-transcript-language-issue` and need
verification under [feat-740](../../roadmap/content-discovery/feat-740-reconcile-recommendation-profile-mismatches.md).
Their selections are provisional. Shared selections and metadata-only evidence
are explicitly labeled in JSON and CSV.

The snapshot establishes at least one published playable dub for each target at
export time. It does not establish present publication, viewer-language audio,
visibility restrictions, or source-family eligibility. Any future serving
integration must apply the current Admin eligibility contracts, including family
exclusions and canonical deduplication; this list can intentionally contain a
related edition or chapter that a particular serving surface would exclude.
See the [recommendation policy](../../analytics-and-recommendation-policy.md).

No production writes or additional model API calls were used to prepare this
draft. Serving a precomputed ID list requires no model inference at request time.
The report's `catalogueSha256` identifies the original local evidence export;
that full profile export is not included in this PR.

## Validation

From the repository root:

```sh
python3 docs/recommendations/editorial-2026-10-19/validate.py
pnpm exec prettier --check docs/recommendations/editorial-2026-10-19
```

The validator checks complete source coverage against the saved snapshot, six
distinct canonical and core targets per source, no self-links, contiguous ranks,
target membership/title/core fidelity, playback snapshot eligibility, CSV/JSON
agreement, embedded review-page agreement, and reported counts. It does not
judge editorial quality or query production.

## Completed operator import

The deployed Admin endpoint completed generation `editorial-catalog-20261019-v1`
on 19 October 2026. [Preflight exclusions](import-preflight.json) and the
[completion/readback receipt](import-receipt.json) preserve exactly what was
admitted: 1,017 sources with six choices, nine with five after duplicate-content
rejection, and five empty sources pending evidence reconciliation. Total: 1,031
source rows and 6,147 links. Original JSON/CSV/HTML retain all 6,186 draft links.

[Compare JESUS in Admin](https://admin.jesusfilm.org/dashboard/recommendations/precomputed?generation=editorial-catalog-20261019-v1&source=cmp76xcw602imny01vnsbwwy9&audio=english).
The completed generation is selectable by existing private A/B tools. No
experiment was activated and public controls are unchanged.
