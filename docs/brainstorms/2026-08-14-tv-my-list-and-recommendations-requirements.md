---
date: 2026-08-14
topic: tv-my-list-and-recommendations
---

# TV — My List + "Because you watched" rail

## Problem Frame

The TV app now has accounts, synced watch progress, resume, and autoplay — but a
viewer still has no way to say "I want to watch this later," and the Home screen
shows everyone the same rails regardless of what they've watched. These are the
two standard connected-TV furniture pieces the app is missing: a self-curated
watchlist and zero-effort personalization. Together they make the library feel
like it grows with the viewer, which is the retention mechanism every major CTV
app leans on.

## Requirements

- R1. The details page (video and series) gains a **My List** toggle in the
  action row beside Play / Language / Subtitles / Share: one Select adds, a
  second removes, with instant visual state change. Both videos (films,
  episodes) and series/collections are saveable.
- R2. Home gains a **My List rail** showing saved items newest-first. The rail
  is hidden entirely when the list is empty — an empty rail is a bug, a missing
  rail is not.
- R3. Long-pressing a My List card removes it, mirroring the Continue Watching
  long-press gesture. Removal is instant locally and never waits on the network.
- R4. My List works signed out: device-scoped local storage, exactly like the
  anonymous Continue Watching shelf. On sign-in the local list merges into the
  account and syncs across devices. Shared-TV rules mirror Continue Watching's
  ownership marker: a previous viewer's leftovers never upload into a different
  account, and sign-out wipes the local list.
- R5. Home gains one **"Because you watched <title>"** rail seeded from the
  viewer's watch history. It requires no viewer setup and is hidden when there
  is no seed or no recommendation data.
- R6. Both new rails follow the existing Home rail conventions: D-pad focus,
  focus memory on back-navigation, card imagery precedence, WATCH_THEME.

## Success Criteria

- Save on the details page → the item is on Home's My List rail immediately.
- Sign in on a second device → the same list appears there.
- A fresh install with no history shows neither new rail (no empty shells).
- The recommendations rail renders against real production data, verified on
  the tvOS simulator (the screenshot channel), not just in tests.

## Scope Boundaries

- Home rail only for recommendations — no "More like this" section on details
  pages in v1.
- One list per account — no per-profile or multiple named lists.
- No manual reordering; newest-first is the only order.
- No admin curation/editor UI changes.
- TV-first: web/mobile adoption of the same account list is out of scope here,
  but the account schema should not be TV-specific.

## Key Decisions

- **Both halves ship in v1**: one coherent "library grows with you" release
  rather than two thin ones.
- **Videos + series are saveable**: matches what every Home card can already
  link to; a videos-only list would surprise anyone saving from a series page.
- **Local-first, account-synced**: mirrors the proven Continue Watching
  architecture (locked local storage, background push, ownership marker,
  sign-out wipe) instead of inventing a second sync model.
- **Recommendations seed from watch history, not My List**: works for viewers
  who never curate; My List is a signal we can add later.

## Dependencies / Assumptions

- Admin needs a persistence surface for the account list (mutations/queries in
  the spirit of `myWatchProgress` / `upsertMyWatchProgress` /
  `clearMyWatchProgress`), plus the TV user-bearer allowlist additions that
  pattern requires.
- Assumes admin's existing recommendations capability (already consumed by web)
  can serve the TV rail; verify shape during planning.

## Outstanding Questions

### Resolve Before Planning

- (none)

### Deferred to Planning

- [Affects R5][Technical] Which admin recommendations query does TV reuse
  (web's `recommendations.ts` precedent), and can it be seeded by a videoId
  from watch history?
- [Affects R1][Technical] How a saved series is represented (container id vs
  video id — align with CONCEPTS.md vocabulary) so the account schema isn't
  TV-specific.
- [Affects R5][Needs research] Seed selection when several recent watches
  exist (most recently finished vs most recently watched vs highest progress).
- [Affects R4][Technical] Whether the anonymous-merge promotion flow
  (ANONYMOUS_STATE_KEYS enumeration) gains the list key in the same locked
  write pattern as pending completions.

## Next Steps

→ `/ce:plan` for structured implementation planning
