---
date: 2026-06-02
type: feat
scope: web-watch-i18n
status: completed
roadmap: docs/roadmap/platform/feat-155-watch-ui-official-language-catalogs.md
origin: docs/brainstorms/2026-06-02-watch-ui-official-language-catalogs-requirements.md
owner: codex
---

# Watch UI Official-Language Catalog Rollout

## Goal

Ship the first reviewable slice of the official-language UI catalog rollout for
`apps/web`: activate Bangla watch chrome through a real `bn` message catalog and
create an auditable official/national-language inventory from the supplied GA4
country list using Unicode CLDR territory language data.

This plan implements the requirements doc's batching allowance rather than
trying to land every official-language translation in one PR. The first PR must
make the Bangla production issue fixable end to end, prove the generated
catalog path still works, and leave a concrete inventory for follow-up catalog
batches (see origin:
`docs/brainstorms/2026-06-02-watch-ui-official-language-catalogs-requirements.md`).

## Current Context

`apps/web` already uses `next-intl` with generated UI locale membership from
`apps/web/messages/*.json`. Public watch language slugs stay separate from UI
message catalogs and HTML language identity. That is the correct foundation:
adding a real catalog and regenerating `apps/web/src/i18n/generated-ui-locales.ts`
should make the existing resolver pick the new UI locale automatically.

The supplied GA4 file is country-based, so the broad language rollout needs a
country-to-official/national-language derivation step before more catalogs are
added. Unicode CLDR's `supplemental/territoryInfo.json` includes territory
language populations and `_officialStatus` values, making it a suitable
machine-readable public authority for this first inventory pass.

## Scope

In this PR:

- Add a normalized country input derived from the supplied GA4 country report,
  without committing analytics metrics.
- Add a CLDR-backed inventory generator and committed inventory output for
  official/national languages in those countries.
- Add a real Bangla UI catalog at `apps/web/messages/bn.json`.
- Regenerate `apps/web/src/i18n/generated-ui-locales.ts`.
- Add focused tests/validation for catalog membership and inventory behavior.
- Browser-smoke a Bangla watch URL for localized chrome.

Out of this PR:

- Bulk-adding every newly identified catalog.
- Treating machine-generated bulk translations as reviewed final copy.
- Changing public watch URL shape.
- Translating video metadata, subtitles, transcripts, or audio.
- Adding new public audio language support.

## Key Technical Decisions

- Use CLDR territory language data for the first external authority because it
  is public, machine-readable, versioned, and includes official-status metadata.
- Commit the derived country list rather than the full GA4 export so the repo
  does not absorb traffic, revenue, or user-count analytics.
- Commit the generated official-language inventory so follow-up PRs can review
  target languages and mapping gaps without re-running network-dependent
  research.
- Activate Bangla in this PR because it is the confirmed visible production
  issue and has a known watch public language slug (`bangla-2`) mapping to
  BCP-47 `bn`.
- Do not add placeholder catalogs for other inventory languages. Follow-up
  batches should add reviewed catalogs and regenerate locale membership.

## Implementation Units

### Unit 1 — Roadmap, Requirements, And Planning Artifacts

Files:

- `docs/brainstorms/2026-06-02-watch-ui-official-language-catalogs-requirements.md`
- `docs/roadmap/platform/feat-155-watch-ui-official-language-catalogs.md`
- `docs/plans/2026-06-02-001-feat-watch-ui-official-language-catalogs-plan.md`

Tasks:

- Preserve the requirements document as the origin artifact.
- Add the platform roadmap ticket and mark it `status: "in-progress"`.
- Keep file references repo-relative inside docs.

Validation:

- `git diff --check -- docs/brainstorms/2026-06-02-watch-ui-official-language-catalogs-requirements.md docs/roadmap/platform/feat-155-watch-ui-official-language-catalogs.md docs/plans/2026-06-02-001-feat-watch-ui-official-language-catalogs-plan.md`

### Unit 2 — CLDR Official-Language Inventory

Files:

- `apps/web/scripts/watch-ui-official-languages.mjs`
- `apps/web/scripts/watch-ui-official-languages.test.ts`
- `apps/web/data/watch-ui/cldr-territory-info-v48.json`
- `docs/i18n/watch-ui-ga4-countries.csv`
- `docs/i18n/watch-ui-official-language-inventory.json`

Tasks:

- Add a small generator that reads a country list and CLDR territory data.
- Map the GA4 country names to CLDR territory codes, with explicit aliases for
  naming differences such as Congo - Kinshasa, Türkiye, Hong Kong, and U.S.
  territories.
- Include languages whose CLDR status is `official`, `official_regional`,
  `official_minority`, or `de_facto_official`.
- Output country rows, language rows, CLDR version metadata, unsupported or
  ambiguous mapping notes, and a summary count.
- Add tests covering official-status filtering, alias mapping, and unmapped
  country reporting.

Validation:

- `pnpm --filter @forge/web test -- scripts/watch-ui-official-languages.test.ts`

### Unit 3 — Bangla UI Catalog Activation

Files:

- `apps/web/messages/bn.json`
- `apps/web/src/i18n/generated-ui-locales.ts`
- `apps/web/src/lib/locale.test.ts`
- `apps/web/src/proxy.test.ts`

Tasks:

- Add a complete Bangla catalog with every key from `apps/web/messages/en.json`.
- Regenerate the generated UI locale module so `bn` appears in
  `AVAILABLE_UI_LOCALES`.
- Add/adjust tests proving `bangla-2` resolves to the `bn` UI catalog and
  rewrites with Bangla HTML/UI identity when the catalog exists.
- Keep unsupported languages falling back through the current behavior.

Validation:

- `pnpm --filter @forge/web check:ui-locales`
- `pnpm --filter @forge/web test -- src/i18n/__tests__/messages-parity.test.ts src/lib/locale.test.ts src/proxy.test.ts`

### Unit 4 — Final Validation And Browser Proof

Files:

- `docs/qa/watch-ui-bangla-catalog-smoke-2026-06-02.md`

Tasks:

- Run `pnpm --filter @forge/web typecheck`.
- Start the web app or use an existing local server if one is already running.
- Use Helium/browser proof for a Bangla watch URL and confirm the visible app
  chrome is Bangla for the hero label, hero CTA, and download button.
- Record the smoke target, commands, and result.

Validation:

- `pnpm --filter @forge/web typecheck`
- Browser smoke for `/watch/bp-plot-episode-5.html/bangla-2.html?t=43.897444`

## Test Scenarios

- Given the CLDR fixture includes official and non-official languages, the
  inventory generator includes only official/national statuses.
- Given a GA4 country name differs from CLDR territory display naming, the
  inventory generator resolves it through an explicit alias.
- Given a country cannot be mapped, the generated inventory records the country
  as unmapped instead of failing silently.
- Given `apps/web/messages/bn.json` exists, `bangla-2` resolves to `bn` and the
  proxy rewrites the public Bangla watch URL to an internal Bangla UI route.
- Given a non-catalog language remains missing, locale resolution still falls
  back to English rather than admitting invalid routes.
- Given a catalog key is missing from `bn.json`, the message parity test fails.

## Risks

- Bangla copy quality needs human/localization-owner review. Mitigation: keep
  the PR clear that this is app-owned chrome copy and record follow-up review
  expectations in the PR body.
- CLDR territory data may not express every "national language" nuance the
  ministry expects. Mitigation: preserve source metadata and mapping gaps so
  localization owners can amend the inventory.
- The first inventory may produce a large follow-up target list. Mitigation:
  ship inventory and Bangla activation first, then batch catalogs by review
  readiness.

## Dependencies

- Unicode CLDR territory language data, version 48.
- Existing `apps/web` i18n generator and message parity test.
- A local or production-like watch page that can render the Bangla route for
  browser smoke.
