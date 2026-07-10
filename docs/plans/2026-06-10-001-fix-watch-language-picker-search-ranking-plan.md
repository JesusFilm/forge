---
title: "Watch language picker search ranking plan"
type: "fix"
status: "completed"
date: "2026-06-10"
---

# Watch Language Picker Search Ranking Plan

## Summary

Improve the watch language picker so non-empty searches rank direct language
matches above incidental substring matches, while preserving the current simple
local filtering model and stable alphabetical order inside each match tier.

---

## Problem Frame

The watch modal builds language options in alphabetical display-name order, and
the shared combobox currently filters those options with substring checks while
preserving that incoming order. This makes `russi` show rows such as
Belorussian and Buriat, Russia before Russian, even though Russian is the
strongest match a user is likely looking for.

---

## Requirements

**Search Result Order**

- R1. For a non-empty query, label-prefix matches rank before word-prefix
  matches, and word-prefix matches rank before other substring matches.
- R2. Within each match tier, results preserve the caller-provided order so
  existing A-to-Z sorting remains stable.
- R3. Search continues to match both display labels and native labels, including
  native labels derived from BCP-47 when no explicit native name is present.

**Existing Picker Behavior**

- R4. Empty queries render options in their original order.
- R5. The selected option remains highlighted by selection state but is not
  pinned above stronger search matches.
- R6. Keyboard navigation, active-option reset, and Enter selection operate on
  the ranked result list after each query change.

**Scope Safety**

- R7. The change does not alter language data, display-name derivation, flags,
  route navigation, subtitle selection, or broader content search behavior.

---

## Key Technical Decisions

- KTD1. Rank inside the shared combobox: The query and filtered list live in the
  combobox, and both audio and subtitle selectors already use that component.
  Keeping ranking there applies the rule consistently without changing callers.
- KTD2. Use simple textual match tiers: The accepted behavior is a minimal
  prefix bump, not fuzzy search. Lowercase text matching is enough to preserve
  the existing predictable search model.
- KTD3. Preserve caller order inside tiers: The modal already supplies A-to-Z
  display-name order. Stable tiering improves relevance without introducing a
  competing sort.

---

## Implementation Units

### U1. Roadmap And Plan Artifacts

- **Goal:** Add a small roadmap ticket and this implementation plan so the work
  has a durable scope anchor.
- **Files:** `docs/roadmap/platform/feat-169-watch-language-picker-search-ranking.md`,
  `docs/roadmap/README.md`,
  `docs/plans/2026-06-10-001-fix-watch-language-picker-search-ranking-plan.md`
- **Test Scenarios:** Documentation-only unit; verify frontmatter is present,
  paths are repo-relative, and the roadmap ticket is marked in-progress before
  implementation.
- **Verification:** `git diff --check`

### U2. Combobox Match Tiering

- **Goal:** Rank non-empty search results by label-prefix, word-prefix, and
  substring tiers while preserving existing behavior for empty queries,
  selection highlighting, and keyboard navigation.
- **Files:** `apps/web/src/components/watch/LanguageCombobox.tsx`,
  `apps/web/src/components/watch/__tests__/LanguageCombobox.test.tsx`
- **Patterns:** Keep the existing `useMemo`-driven filtered list and reuse the
  current native-name lookup so the ranked list remains the single source for
  rendering and keyboard selection.
- **Test Scenarios:**
  - Searching `russi` with Belorussian, Buriat, Russia, Central Asian Russian,
    and Russian puts Russian first, Central Asian Russian in the word-prefix
    tier, and incidental substring matches after it.
  - Matches inside the same tier retain their incoming order.
  - Native-name search still works, and native prefix matches participate in the
    same tiering behavior.
  - A selected row that is only a weaker match remains highlighted but does not
    move ahead of a stronger match.
  - Empty query order remains unchanged.
- **Verification:** `pnpm --filter @forge/web test -- src/components/watch/__tests__/LanguageCombobox.test.tsx`

---

## Scope Boundaries

- No fuzzy matching, typo tolerance, popularity ranking, region ranking, or
  speaker-count ranking.
- No change to language identity, language display heuristics, flag rendering,
  public watch URL shape, subtitle state, or player behavior.
- No change to broader Forge content search or admin search ranking.

---

## Risks And Dependencies

- Ranking must stay cheap for roughly two thousand options; the implementation
  should avoid extra React state and keep the ranking work inside the existing
  memoized search path.
- Native-label matching includes non-Latin scripts. The plan keeps the existing
  lowercase substring semantics rather than introducing locale-specific
  tokenization.

---

## Sources

- `docs/roadmap/platform/feat-169-watch-language-picker-search-ranking.md`
- `apps/web/AGENTS.md`
- `apps/web/CLAUDE.md`
- `apps/web/src/components/watch/LanguagePickerModal.tsx`
- `apps/web/src/components/watch/LanguageCombobox.tsx`
- `apps/web/src/lib/language-display.ts`
- `apps/web/src/components/watch/__tests__/LanguageCombobox.test.tsx`
