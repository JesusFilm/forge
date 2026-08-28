---
status: pending
priority: p2
issue_id: "024"
title: apps/tv still renders scripture from an unreviewed-licence community mirror
labels:
  - tv
  - watch
  - licensing
  - bible-quotes
created_at: 2026-08-27
---

# Problem

`apps/tv` fetches Bible verse text client-side from a community GitHub
repository served over jsDelivr:

- `apps/tv/src/lib/bibleVerseFetch.ts` —
  `https://cdn.jsdelivr.net/gh/wldeh/bible-api/bibles`
- `apps/tv/src/hooks/useBibleVerses.ts` — one request per citation, version
  pinned `en-webbe`
- `apps/tv/src/lib/bibleVerses.ts` — `bookSlugForApi`, `formatScripture`

**Nobody has licence-reviewed that repository.** A shipping app renders
scripture from it, and no card names a translation or a copyright holder,
because the mirror returns neither in any response.

`apps/mobile` carried the same stack and removed it on 2026-08-27, moving to
admin's server-resolved `BibleCitation.passage`, which returns the translation
name and the copyright line with every passage. `apps/web` removed its copy on
2026-07-03. **`apps/tv` holds an independent copy and did not inherit either
change** — the two apps' Bible-verse modules are copies, not a shared package.

The same source also produces wrong scripture, which is what prompted the
mobile work: it drops verse ranges (a citation recorded as Genesis 1:26-27
renders only verse 26), inlines footnote text into the verse body with no
delimiter, and stores only the first line of a poetic verse.

# Scope

**This entry states the exposure. It does not prescribe the remedy, and it does
not schedule one.** The TV track owns its own framing and timing. The mobile
plan that surfaced this deliberately excluded TV
(`docs/plans/2026-08-27-1237-fix-mobile-bible-quotes-passages-plan.md`, Scope
Boundaries).

# Owner

Unassigned. Needs an owner on the TV track.

# Where the mobile replacement lives, if TV follows it

- `apps/mobile/src/lib/queries.ts` — `GET_VIDEO_BIBLE_PASSAGES`, a companion
  operation. `passage` must NOT go on a player-gating fragment, and
  `documentId: id` is required on `videoBySlug` itself as well as on
  `bibleCitations`.
- `apps/mobile/src/lib/biblePassages.ts` — the fail-closed projection.
- `apps/mobile/src/lib/citationFormat.ts` — the reference label for a citation
  whose passage did not resolve.
- `apps/mobile/CLAUDE.md`, "Conventions" — the rule and its traps.

No admin change and no codegen step are needed: `BibleCitation.passage` and all
of its subfields are already in the committed introspection.
