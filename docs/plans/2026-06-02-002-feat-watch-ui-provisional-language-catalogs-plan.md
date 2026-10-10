---
date: 2026-06-02
type: feat
scope: web-watch-i18n
status: completed
roadmap: docs/roadmap/platform/feat-156-watch-ui-provisional-language-catalogs.md
origin: docs/brainstorms/2026-06-02-watch-ui-official-language-catalogs-requirements.md
owner: codex
---

# Watch UI Provisional Official-Language Catalogs

## Goal

Create provisional `apps/web/messages/*.json` catalogs for every language tag in
`docs/i18n/watch-ui-official-language-inventory.json`, then regenerate UI locale
membership so the existing watch UI resolver can activate those locales.

This is the expansion the user requested after the first Bangla-focused slice:
the first PR added Bangla plus the official-language inventory; this follow-up
within the same branch adds catalog files for every inventory language now.

## Scope

In this PR update:

- Add a reusable generator for missing provisional UI catalogs.
- Generate catalog files for every inventory language tag that does not already
  have an authored catalog.
- Leave existing translated/authored catalogs untouched.
- Add a manifest that records which locales are provisional and why.
- Regenerate `apps/web/src/i18n/generated-ui-locales.ts`.
- Add tests that assert inventory languages have catalogs and generated locale
  membership.
- Update the roadmap ticket and PR description with the provisional-copy risk.

Out of scope:

- Native-speaker or ministry review for every generated catalog.
- Machine-translating every string in this implementation pass.
- Changing public watch URL shape.
- Adding or implying audio, subtitle, transcript, title, or description
  availability for the newly cataloged languages.

## Key Technical Decisions

- Seed missing catalogs from `apps/web/messages/en.json` instead of fabricating
  translations. This preserves ICU placeholders and key parity while making the
  provisional status honest.
- Keep existing catalogs authoritative. The generator must skip any locale that
  already exists under `apps/web/messages`.
- Store a generated manifest at
  `docs/i18n/watch-ui-provisional-catalogs.json` so localization owners can
  distinguish already-authored catalogs from English-seeded provisional ones.
- Test against the inventory output, not a hand-maintained locale list, so
  future inventory updates fail loudly until matching catalogs are generated.

## Implementation Units

### Unit 1 — Provisional Catalog Generator

Files:

- `apps/web/scripts/generate-provisional-ui-catalogs.mjs`
- `apps/web/package.json`
- `docs/i18n/watch-ui-provisional-catalogs.json`

Tasks:

- Read `docs/i18n/watch-ui-official-language-inventory.json`.
- Read `apps/web/messages/en.json` as the seed catalog.
- For each inventory language tag, create `apps/web/messages/<tag>.json` only
  when the file is missing.
- Emit a manifest listing inventory count, existing catalog count, provisional
  catalog count, generated date, source catalog, and generated locale tags.
- Support `--check` so CI can detect stale generated provisional catalogs.

Test scenarios:

- Given a missing inventory locale, the generator writes a catalog seeded from
  English.
- Given an existing locale catalog, the generator does not overwrite it.
- Given the generated manifest is stale, `--check` fails.

Verification:

- `pnpm --filter @forge/web generate:provisional-ui-catalogs -- --generated-on 2026-06-02`

### Unit 2 — Catalog Coverage And Locale Membership

Files:

- `apps/web/messages/*.json`
- `apps/web/src/i18n/generated-ui-locales.ts`
- `apps/web/src/lib/__tests__/watch-ui-provisional-catalogs.test.ts`

Tasks:

- Generate missing provisional catalog files for every inventory language tag.
- Regenerate UI locales with `apps/web/scripts/generate-ui-locales.mjs`.
- Add tests proving every inventory language has a message file and generated
  UI locale entry.
- Add tests proving provisional catalog files are structurally identical to the
  English seed so ICU placeholders are preserved.

Test scenarios:

- Every language in `docs/i18n/watch-ui-official-language-inventory.json`
  exists in `apps/web/messages`.
- Every inventory language appears in `AVAILABLE_UI_LOCALES`.
- Every provisional catalog listed in
  `docs/i18n/watch-ui-provisional-catalogs.json` matches the English seed
  catalog exactly.
- Existing authored catalogs are not marked provisional.

Verification:

- `pnpm --filter @forge/web check:ui-locales`
- `pnpm --filter @forge/web test -- src/i18n/__tests__/messages-parity.test.ts src/lib/__tests__/watch-ui-provisional-catalogs.test.ts`

### Unit 3 — Final Validation And PR Handoff

Files:

- `docs/roadmap/platform/feat-156-watch-ui-provisional-language-catalogs.md`
- Existing PR body for `feat/watch-ui-official-language-catalogs`

Tasks:

- Run lint, typecheck, focused catalog tests, and diff checks.
- Browser-smoke one representative newly generated provisional locale route to
  confirm the resolver admits generated catalog membership.
- Mark the roadmap ticket complete after validation.
- Commit, push, and update the existing PR description.

Test scenarios:

- A newly generated inventory locale is accepted by the generated UI locale
  guard.
- The browser smoke reaches the expected locale identity for a generated
  catalog without changing public URL shape.

Verification:

- `pnpm --filter @forge/web lint`
- `pnpm --filter @forge/web typecheck`
- `git diff --check`
- Helium/`agent-browser` smoke for one generated provisional locale route

## Risks

- English-seeded provisional catalogs do not solve translation quality. The PR
  must label them as provisional and keep localization review as follow-up work.
- Adding hundreds of catalogs increases generated locale membership and route
  surface. Tests should lock catalog parity and inventory coverage, but browser
  smoke should remain representative rather than exhaustive.
- Some inventory tags may not correspond to public audio slugs. This is
  acceptable because UI catalog availability remains separate from content and
  audio availability.

## Dependencies

- `docs/i18n/watch-ui-official-language-inventory.json` from feat-155.
- Existing `apps/web/messages/en.json` as the structural seed.
- Existing generated UI locale workflow.
