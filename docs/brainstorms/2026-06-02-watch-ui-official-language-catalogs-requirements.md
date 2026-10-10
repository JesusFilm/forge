---
date: 2026-06-02
topic: watch-ui-official-language-catalogs
---

# Watch UI Official Language Catalogs

## Summary

Add real watch UI message catalogs for Bangla and for every official or national language represented by countries in the supplied GA4 country report, using an external public authority for country-to-language scope. The rollout should extend the existing catalog-driven i18n system so supported watch URLs render localized chrome without changing public route shape or conflating UI language with audio/content availability.

---

## Problem Frame

The Bangla watch page can serve Bangla content metadata while still rendering English app chrome such as "Episode", "Download", and "Play with Sound". The current watch i18n system correctly separates public audio slugs, UI message catalogs, and HTML language identity, so unsupported UI catalogs fall back to English even when the page's audio/content language is non-English.

This creates a visible mismatch for viewers whose content is localized but whose app controls remain English. The same issue is likely to appear beyond Bangla as traffic expands across countries in the GA4 country report. Because the report is country-based rather than language-based, the rollout needs an explicit country-to-language scope rule instead of inventing ad hoc language coverage.

---

## Actors

- A1. Watch viewer: Watches localized Jesus Film content and expects visible controls, labels, modals, and helper UI to match their language when a catalog exists.
- A2. Localization owner: Decides which language catalogs are valid to ship and whether translations are human-reviewed or still provisional.
- A3. Implementing agent or engineer: Turns this requirements doc into a plan, generates or imports catalogs, runs validation, and verifies production-like watch behavior.
- A4. External language authority: Supplies the country-to-official/national-language mapping used to derive rollout scope.

---

## Key Flows

- F1. Scope derivation
  - **Trigger:** A planner starts from the supplied GA4 country report.
  - **Actors:** A2, A3, A4
  - **Steps:** Determine the unique country list, derive each country's official or national languages from an external public authority, normalize those languages to UI locale identities, and record any ambiguous or unmappable cases.
  - **Outcome:** The rollout has an auditable target-language inventory rather than a manually guessed list.
  - **Covered by:** R1, R2, R3, R4

- F2. Catalog activation
  - **Trigger:** A real message catalog is added for a target language.
  - **Actors:** A1, A2, A3
  - **Steps:** The app includes the catalog in generated UI locale membership, watch locale resolution finds it from the existing public language slug or BCP-47 identity, and visible chrome renders in that language when the viewer lands on a matching watch URL.
  - **Outcome:** The viewer sees localized watch chrome while public URL shape and audio/content selection behavior remain unchanged.
  - **Covered by:** R5, R6, R7, R8

- F3. Translation quality review
  - **Trigger:** A broad set of new catalogs is prepared for inclusion.
  - **Actors:** A2, A3
  - **Steps:** Catalogs are checked for structural parity, obvious machine-translation issues, missing placeholders, right-to-left rendering needs where applicable, and at least one representative watch-page smoke path per newly activated catalog family.
  - **Outcome:** The rollout avoids treating unreviewed generated copy as final product copy.
  - **Covered by:** R9, R10, R11

---

## Requirements

**Scope and language inventory**

- R1. The target inventory must begin with Bangla and every country listed in the supplied GA4 country report.
- R2. For each country in scope, the target language set must include every language identified by an external public authority as official or national for that country.
- R3. The inventory must preserve provenance for the external authority used and the date or version of the source data consulted.
- R4. The inventory must identify languages that are ambiguous, have multiple plausible BCP-47 identities, or cannot be normalized cleanly, rather than silently skipping or collapsing them.

**UI catalog behavior**

- R5. Adding a target language catalog must use the existing catalog-driven UI locale mechanism: once a real catalog exists and generated UI locale membership is refreshed, matching watch routes should render localized chrome without a hand-maintained locale whitelist.
- R6. Public watch URL shape must remain unchanged. The audio-language slug in the existing URL continues to be the public language carrier.
- R7. UI catalog availability must remain separate from audio/content availability. A localized UI catalog must not imply that every video has a matching dub, localized title, subtitle, transcript, or description.
- R8. When a watch language does not have a matching UI catalog after this rollout, the page should continue to fall back through the existing locale-resolution behavior instead of failing or redirecting to an invalid route.

**Translation coverage and quality**

- R9. Each new catalog must cover the existing app-owned message namespaces and keys so structural message parity remains intact.
- R10. Catalog copy must preserve variables, pluralization, punctuation placeholders, and any ICU message semantics required by the existing English source.
- R11. New catalogs should be treated as product copy that needs localization review, not as final merely because machine translation produced a syntactically valid JSON file.
- R12. Right-to-left languages in scope must be explicitly identified so planning can account for directionality and visual smoke coverage.

**Verification and handoff**

- R13. Validation must prove the generated UI locale list matches the catalog files and that structural parity passes across all catalogs.
- R14. Validation must include representative watch-page smoke coverage for Bangla and for a sample of newly activated language families, including at least one right-to-left language if any are added.
- R15. The final implementation handoff must include the target-language inventory, unsupported or ambiguous mappings, validation commands, and smoke-test URLs used.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R5, R6.** Given Bangladesh is present in the GA4 country report and Bangla is identified as an official or national language, when the Bangla UI catalog is added and generated UI locales are refreshed, a Bangla watch URL renders app chrome such as media labels and player calls to action in Bangla without changing the public watch URL.
- AE2. **Covers R4, R15.** Given an external authority returns a language identity that does not map cleanly to a current app locale identity, when the target inventory is prepared, that language appears in a mapping-gaps section with the reason it was not activated automatically.
- AE3. **Covers R7, R8.** Given a target language has UI chrome copy but a specific video does not have a matching audio dub or localized metadata, when a viewer opens that video, the UI catalog behavior does not invent missing content and the existing audio/content fallback rules still govern playback and metadata.
- AE4. **Covers R9, R10, R13.** Given a new catalog omits a namespace key or breaks an ICU placeholder from the English source, when validation runs, the catalog is rejected before merge.
- AE5. **Covers R11, R14.** Given a broad batch of generated catalogs is prepared, when the rollout is validated, at least representative human or localization-owner review plus watch-page smoke evidence is recorded before the catalogs are treated as ready to ship.

---

## Success Criteria

- Bangla watch pages no longer show English app-owned chrome when a matching Bangla UI catalog exists.
- The project has an auditable target-language inventory derived from the GA4 country list and an external public authority, not from ad hoc guesses.
- New UI catalogs activate through the existing generated catalog workflow without changing public watch URL shape.
- Translation quality, structural parity, and representative visual behavior are verified before shipping.
- Downstream planning can proceed without inventing the scope rule, the separation between UI and content languages, or the expected validation standard.

---

## Scope Boundaries

- Do not change the public watch URL shape.
- Do not translate video metadata, descriptions, subtitles, transcripts, or audio as part of this rollout.
- Do not add new public audio-language support merely because a country-language inventory includes that language.
- Do not replace the existing catalog-driven i18n architecture.
- Do not treat machine-generated translations as final product copy without review.
- Do not require every language in the external inventory to activate in one PR if planning finds that batching is safer.

---

## Key Decisions

- Country-to-language scope uses an external public authority: The supplied GA4 report lists countries, so a public country-language source is needed to avoid inventing language coverage.
- Coverage target is official/national languages, not only top-traffic languages: The user explicitly chose full official/national coverage over a narrower prioritization.
- UI catalog rollout remains separate from content localization: The original Bangla issue is app chrome fallback, not missing Bangla video content.
- Existing watch routing remains the foundation: The current system already supports catalog-driven activation when real message files exist, so the requirements extend that path instead of designing a new routing model.

---

## Dependencies / Assumptions

- The supplied GA4 country report is the authoritative country input for this brainstorm.
- The selected external authority can provide a stable enough country-to-official/national-language mapping for planning and review.
- Some countries may have many official or national languages, and some languages may share broad BCP-47 families or need more specific script/region tags.
- Some target languages may not correspond cleanly to current Forge public watch language slugs; those cases should be recorded as gaps for follow-up.
- Existing i18n parity tests and generated UI locale checks remain the baseline guardrails for catalog additions.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R2, R3][Needs research] Which external authority should be used as the primary source, and what fallback source should be allowed when countries or territories are missing?
- [Affects R4, R15][Technical] How should the implementation represent language inventory rows that map to more than one script, region, or Forge language slug?
- [Affects R11][User decision] What level of human review is required before a generated catalog can ship: native speaker review, ministry reviewer approval, or provisional launch with explicit follow-up?
- [Affects R14][Technical] What sample set gives adequate smoke coverage without making the first rollout too large to validate?
