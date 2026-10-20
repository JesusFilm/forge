# Watch overnight website audit: final report

Date: 2026-10-20 (UTC). Ten sequential review rounds ran from about 02:20Z to
09:16Z, then this synthesis. Scope: the public Watch site (`apps/web`) at
`https://www.jesusfilm.org/watch`, audited read-only in production and in
local builds of the same code. Every round used Claude Opus 5.5 on the
authenticated NZ Team. The US Team was unauthenticated each time it was
checked, so no rotation happened.

Nothing was merged or deployed. Every fix below is **implemented in an open
PR**, not shipped. Per-round detail lives in the round reports
(`2026-10-20-watch-website-audit-round-01.md` in #2821, round 02 in #2825,
round 03 in #2827, round 04 in #2832).

## Answer first

- 23 open PRs from this audit (19 code, 4 docs, including this one). 4 of
  the 19 code PRs are older team PRs that were repaired and revived. The
  older #2626 was reviewed and found superseded by #2829.
- On 2026-10-20 09:18Z, all 22 code and earlier docs PRs were `MERGEABLE`,
  `CLEAN` and passed `ci-gate` on their current heads. They also merge together:
  5 PR pairs conflict in 3 files, and every resolution is recorded below.
- Performance: four separate, measured lab wins (crypto polyfill, server
  Markdown, font subsets, deferred home intro). The experiments are
  separate, so their numbers must not be added up. None is a field
  measurement.
- Accessibility and mobile: the biggest keyboard and phone defects found are
  fixed in PRs. These include skip link and header order, search focus, the
  download quality list, the language dialog Escape, hero pause and reduced
  motion, layout at 320 px and at 200% text, and route error landmarks.
- Still open: soft 404 (feat-757), noisy search snippets (feat-760),
  editorial and content items, the download size policy, focus after
  "Try again" on route errors (feat-774), and checks no round could run
  (Safari, real devices, screen readers, signed-in pages).

## Personas and jobs to be done

These are heuristic personas, not user research or interviews. Round 02
observed each path in production at 1280x800 and 390x844.

| Persona    | Situation / trigger                                                          | Motivation                                    | Desired outcome                                                                      | Success criteria                                                                                            |
| ---------- | ---------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Unbeliever | Gets a shared link, or searches "Jesus movie"; no church background          | Understand what this is before giving it time | Knows what the video is, watches some in their own language, leaves without pressure | Subject and length are clear in seconds; no account; page is in their language                              |
| Seeker     | Has a question such as "is God real?"                                        | Honest answers, no pressure                   | A short video on the question, then a person to ask                                  | Search and home surface question-led videos; results explain the match; a human next step is visible        |
| Believer   | Wants to grow, or to share with a friend or group, often in another language | Trustworthy material to pass on               | Follows a course in order; shares in the friend's language                           | Series order and progress; switching language keeps their place; a shared link opens in the chosen language |
| Partner    | Screening, offline device or website embed                                   | Reliable files and embeds in many languages   | Right file size, embed code, partner resources                                       | Size known before download; language and quality clear; resources one click away                            |

Observed path and health (round 02, screenshots in user data):

| #   | Step                                | Persona            | Health               |
| --- | ----------------------------------- | ------------------ | -------------------- |
| 1   | Land on `/watch` (desktop)          | all                | Fair                 |
| 2   | JESUS film page                     | unbeliever         | Good                 |
| 3   | Description and Related Questions   | unbeliever, seeker | Good                 |
| 4   | Download dialog                     | partner            | Fair                 |
| 5   | Search "is god real"                | seeker             | Fair                 |
| 6   | NUA series                          | seeker             | Fair                 |
| 7   | Spanish LUMO John series            | believer           | Poor, fixed in #2824 |
| 8   | Language dialog on a course episode | believer           | Good                 |
| 9   | Home on a 390 px phone              | all                | Fair                 |
| 10  | `/resources` (outside Forge)        | partner            | Fair                 |
| 11  | Share dialog                        | believer           | Good                 |

Confirmed gaps and actions:

| Persona    | Gap                                                                                                   | Action                                                                                            | Owner         | Priority    | State          |
| ---------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------- | ----------- | -------------- |
| Unbeliever | Hero rotates single segments labelled "Segment" with no synopsis; page `h1` is below the fold         | Context line on the hero; bring the intro into the first screen                                   | Web + design  | P2          | Recommendation |
| Seeker     | Search snippets can be caption noise (`[MUSIC] [INAUDIBLE]`)                                          | feat-760 snippet fallback in Admin                                                                | Admin search  | P1          | Ticket (#2825) |
| Seeker     | "is god real" misses curated NUA videos in the top 10                                                 | Measure with the search-eval set before changing ranking                                          | Admin search  | P2          | Recommendation |
| Seeker     | Seeker sections sit about 6 screens down on phones                                                    | Editorial order of the authored home Experience                                                   | Content       | P3          | Recommendation |
| Believer   | Spanish series cards showed English labels                                                            | Localized labels                                                                                  | Web           | P1          | #2824          |
| Believer   | NUA episodes 1–8 labelled "Series"; raw URLs in descriptions                                          | Admin content data                                                                                | Content       | P3          | Report only    |
| Partner    | Download defaults to "Highest" (JESUS: 5.5 GB) with no size shown                                     | Decide: show sizes or default lower on phones (sizes were removed on purpose in feat-310 / #1740) | Product       | P1 decision | Recommendation |
| Partner    | Footer "Share" and "Resources" both redirect to `/resources`; that page's title and headings are weak | Root site, outside Forge                                                                          | Marketing web | P3          | Report only    |

`/resources`, `/partners/` and the rest of the root site are not built from
this repository. They were looked at for the partner journey only and were
not audited.

## Coverage

Thirteen Watch template types, plus shared dialogs. "Checked" means the
round matrices actually ran that cell. Local cells used `.env.ci`, with
no Admin data, unless they say otherwise.

| Template               | 320 | 360     | 390 | 768 / 1024 | 844x390 | Desktop | 200% text | Reduced motion | Keyboard / axe |
| ---------------------- | --- | ------- | --- | ---------- | ------- | ------- | --------- | -------------- | -------------- |
| Home (en)              | yes | no      | yes | yes        | yes     | yes     | yes       | yes            | yes            |
| Language home (es-419) | yes | no      | yes | no         | no      | yes     | no        | no             | axe            |
| Feature film           | yes | dialogs | yes | yes        | yes     | yes     | yes       | yes            | yes            |
| Film, Arabic RTL       | yes | no      | yes | yes        | yes     | yes     | no        | no             | axe            |
| Series                 | yes | no      | yes | yes        | yes     | yes     | yes       | no             | axe + manual   |
| Collection / course    | yes | no      | yes | no         | no      | yes     | no        | no             | axe + Tab walk |
| Episode                | yes | no      | yes | yes        | yes     | yes     | yes       | yes            | axe + Tab walk |
| Topic experience       | yes | no      | yes | no         | no      | yes     | no        | no             | axe            |
| Language inventory     | yes | no      | yes | yes        | yes     | yes     | no        | no             | axe            |
| Language directory     | yes | no      | yes | no         | no      | yes     | yes       | no             | axe            |
| What's new             | yes | no      | yes | yes        | yes     | yes     | yes       | yes            | axe + Tab walk |
| History (signed out)   | yes | no      | yes | no         | no      | yes     | no        | no             | axe            |
| Not found              | yes | no      | yes | no         | no      | yes     | no        | no             | axe            |

Shared dialogs and states:

- Search overlay: 320x640, 320x360, 390, 1280. Covered states: browse,
  suggestions, results, fallback results, error, nested language picker,
  cold-load shell.
- Share dialog: 320, 390, 1280.
- Language & Subtitles dialog: 320, 1280, including the nested list.
- Download dialog: 320, 360, 390, 1280.
- Collection download dialog: finished and failed states at 320, 360,
  390, 1280.
- Feedback dialog: 1280.
- Player (round 08, real `HeroPlayer` with a public Mux stream, plus
  read-only production): keyboard (K, Space, J, L, M, F, timeline arrows),
  focus after activation, names and values.
- Loading and error boundaries (round 08, real boundaries in fixtures):
  320 and 1280.

Languages: English, Spanish (es-419) and Arabic (RTL). Russian error copy
appears in unit tests only. The font rendering checks covered
Vietnamese, Cyrillic and other combining-mark scripts.

Not covered at all:

- signed-in history and account (no authorized session)
- real phones and tablets, Safari/WebKit, Firefox
- screen readers (NVDA, VoiceOver) and real on-screen keyboards
- browser fullscreen Escape
- production Admin data in local builds

This is a lab and browser audit with axe checks. It is not a full WCAG
conformance review.

## Performance (lab, separate experiments)

Each row is its own experiment, with its own baseline and profile. Do not
sum the milliseconds. None of these is field data.

| PR               | Change                                                                | Measured result                                                                                                                                                           | Conditions and limits                                                                                                                                       |
| ---------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #2821 (feat-755) | Keep the Node crypto polyfill out of Watch client bundles             | About 136 KB less script on the wire; script time 0.6–1.3 s lower (`/watch` −628 ms, `/whats-new` −1,290 ms, 404 −902 ms); FCP and CLS flat                               | 7 runs per URL, local `next start`, 390x844, 4x CPU, 150 ms RTT, 1.6 Mbps, no Admin data                                                                    |
| #2833 (feat-768) | Render Related Questions Markdown on the server                       | About 35 KB less initial JS on the wire; fixture script −184 ms, load −184 ms; `/watch` script −131 ms, load −164 ms; FCP, LCP and CLS flat                               | Same profile; degraded home without Admin data                                                                                                              |
| #2834 (feat-769) | Split Montserrat into latin / cyrillic / rest `unicode-range` subsets | Latin page font 64.6 KB vs 200.9 KB                                                                                                                                       | Chromium only. The earlier 57.7 KB figure and its timings were measured before the combining-mark fix and are obsolete. Timing was not re-run after the fix |
| #2840 (feat-773) | Mount the home intro player after window `load`                       | Fixture at 1.6 Mbps, 4 interleaved runs: `load` 5,409–5,417 → 5,169–5,178 ms; LCP 4,748–4,764 → 4,488–4,500 ms. Neutral on broadband. At 1.0 Mbps, `load` 8.65 s → 8.28 s | Real carousel and public Mux streams in a fixture page, not the real home page                                                                              |

Font trade-offs (#2834), stated plainly:

- The first version dropped letter-plus-mark clusters (for example "M̧ajeļ",
  a real language name) to a system font. A review caught this, and every
  subset now carries every combining mark.
- The first version also stripped the OFL licence notice. That is fixed too
  (full `name` table kept).
- A Latin page that contains any combining mark now loads all three files
  (about 250 KB).
- A Russian-only page loads about 103 KB and a Vietnamese page about 190 KB.
- A mixed-script page can load all three files.
- Kerning across two files is lost, about 1 CSS px per affected pair.
- Not every locale gets faster. Latin-only pages gain the most.

#2840 and viewer intent: the first version also held an explicit Play until
`load` (about 8 s late in a held-image test). Round 10 fixed this. Play or
unmute now mounts the player at once (playing at 2.6 s in the same setup),
while the passive intro still waits for `load`.

## Rejected ideas

| Idea                                          | Why rejected                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `zod/mini` for the four client zod users      | Real Turbopack build saved about 4 KB br for about 190 lines of churn (esbuild would have shaken more) |
| `experimental.turbopackModuleFragments`       | Build panic in Turbopack                                                                               |
| Bandwidth-test start level for the home intro | About 2 s slower first frame at 1.6 Mbps (it does let the intro start at 1.0 Mbps)                     |
| Shorter intro read-ahead or lower quality cap | Not tried: these are documented design choices                                                         |
| Save-Data / `navigator.connection` gating     | Chromium-only API, can't be lab-tested here, needs a product policy                                    |

Open performance ideas that need a decision, access or field data:

- Blur placeholders only for the first cards per rail. Saves about 10 KB br
  per home HTML. Needs a design call.
- Cloudflare brotli level for dynamic HTML. Saves about 15 KB per view.
  Needs an infra check.
- A client env module without classic zod. Saves about 67 KB br on every
  route. Needs a validation-policy decision.
- A lower first quality rung for the intro on slow links. Product call.
- Re-measure with real Admin data, then check Datadog RUM `load` and LCP on
  mobile `/watch` before and after a deploy.

## Pull requests

New code PRs (15):

| PR                                           | Scope                                                                                                                              | Head        | Base           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------- |
| https://github.com/JesusFilm/forge/pull/2821 | Crypto polyfill out of client bundles (feat-755); also carries the round 01 report and the discovery tickets feat-757 and feat-758 | `d566bc9ab` | main           |
| https://github.com/JesusFilm/forge/pull/2822 | Signed-out history goes to sign-in (feat-756)                                                                                      | `cea998e75` | main           |
| https://github.com/JesusFilm/forge/pull/2824 | Localized series card labels (feat-759)                                                                                            | `d102bba85` | main           |
| https://github.com/JesusFilm/forge/pull/2826 | Keyboard download quality list (feat-761)                                                                                          | `3c15d34ed` | main           |
| https://github.com/JesusFilm/forge/pull/2829 | Hero pause, reduced motion, CTA wrap, hero at 200% text (feat-762, feat-767 part)                                                  | `7dced884d` | main           |
| https://github.com/JesusFilm/forge/pull/2830 | Search label at 320, focus clear of the launcher, focus ring (feat-764)                                                            | `162c7380b` | main           |
| https://github.com/JesusFilm/forge/pull/2831 | Series header on tablet and phone landscape (feat-765)                                                                             | `3dd311383` | main           |
| https://github.com/JesusFilm/forge/pull/2833 | Related Questions server Markdown (feat-768)                                                                                       | `d6bfe45e8` | main           |
| https://github.com/JesusFilm/forge/pull/2834 | Font unicode-range subsets (feat-769)                                                                                              | `1b96e764e` | main           |
| https://github.com/JesusFilm/forge/pull/2835 | Header at large text (feat-767 part)                                                                                               | `a9bf67e9e` | main           |
| https://github.com/JesusFilm/forge/pull/2836 | Download and collection-download footers at 320                                                                                    | `a45e24a16` | main           |
| https://github.com/JesusFilm/forge/pull/2837 | Language dialog Escape keeps focus (feat-771)                                                                                      | `9e1644615` | main           |
| https://github.com/JesusFilm/forge/pull/2838 | Route errors: one landmark, alert, readable text (feat-772)                                                                        | `ac9f1304e` | main           |
| https://github.com/JesusFilm/forge/pull/2839 | What's New semantics and contrast, chapter and home-card alts (feat-763)                                                           | `5ebf36986` | main           |
| https://github.com/JesusFilm/forge/pull/2840 | Home intro mounts after `load`; explicit Play does not wait (feat-773)                                                             | `51e61e7cb` | #2829's branch |

Existing team PRs repaired (4): https://github.com/JesusFilm/forge/pull/2637
(skip link, landmark order; `29f98ebc0`),
https://github.com/JesusFilm/forge/pull/2663 (search focus, 320 fit;
`9395fbd0b`), https://github.com/JesusFilm/forge/pull/2669 (contrast and
targets; `cf7d199da`), https://github.com/JesusFilm/forge/pull/2740 (player
keyboard and srclang; `60b305f4e`).

Docs PRs (4): https://github.com/JesusFilm/forge/pull/2825,
https://github.com/JesusFilm/forge/pull/2827,
https://github.com/JesusFilm/forge/pull/2832, and this report.

Reviewed, not changed: https://github.com/JesusFilm/forge/pull/2626 (older
reduced-motion PR, conflicting, superseded by #2829; left open for the
owner). https://github.com/JesusFilm/forge/pull/2383 (hero CTA re-prefetch)
was not worked on; it is conflicting and still owns that bug.

#2821 carries feat-757 and feat-758 because round 01 found them. They are
ticket files only, with no code or privacy change. They can merge with
#2821 or be split off. Neither choice blocks the code.

### Merge order and conflicts

A local integration of every PR head built cleanly. `next build`, `tsc` and
`eslint` passed. The full web suite gave 5,571 passed and 1 failed. That
failure, `WatchSemanticRecommendations lifecycle › tab storage unavailable`,
also fails on main. The full suite was not re-run after the last two
commits (home cards and docs); those were tested on their own branches.

1. Independent: #2821, #2822, #2824, #2826, #2831, #2833, #2834, #2836,
   #2837, #2839, #2740, docs #2825, #2827, #2832 and this report.
2. Header chain: #2663 → #2637 → #2830 → #2835.
3. #2838 after #2637.
4. #2829, then retarget #2840 to `main` and merge it.
5. #2669 last.

| Pair          | File                            | Resolution                                                                                      |
| ------------- | ------------------------------- | ----------------------------------------------------------------------------------------------- |
| #2663 × #2835 | `FloatingSearchProvider.tsx`    | Keep #2663's open-state class and #2835's closed-state `FLOATING_HEADER_LARGE_TEXT_FIELD_CLASS` |
| #2637 × #2669 | `FloatingSearchProvider.tsx`    | Take #2637's layout, then apply #2669's backdrop alphas `0.72/0.42/0.16`                        |
| #2637 × #2838 | `[locale]/[htmlLang]/error.tsx` | Keep #2838's wrapper and one `<main>`; pass `mainProps={watchMainContentTargetProps}`           |
| #2669 × #2829 | `WatchHomeTvCarousel.tsx`       | Keep #2829's wrapping class (no `sm:flex-nowrap`)                                               |
| #2669 × #2840 | same hunk                       | Same as above                                                                                   |

CI should be re-run after each conflicted merge. Two more follow-ups after
the merges:

- `docs/roadmap/README.md` counts merge silently wrong, and main's counts
  are already stale (the generator gives 890 against 860). Regenerate the
  README once, in a docs PR after the stack lands.
- feat-767 stays in progress until both #2829 and #2835 merge.

## Remaining work (ranked)

1. **Soft 404 (feat-757, P2).** Unknown `/watch/*.html` returns 200 with
   `noindex`.
2. **Search snippets and relevance (feat-760, P1).** Caption-noise
   snippets, and question-led queries missing curated videos. Fix in Admin,
   measured against the search-eval set.
3. **Download size policy (P1, product decision).** Revisit feat-310 now
   that sizes are reliable.
4. **Error recovery focus (feat-774, P2).** After "Try again" on a route
   error, focus falls to `<body>`. At 200% text, the inline
   `ExperienceError` on `/watch` sits under the header at 320 and 390 px.
5. **Consent grant retry while erasure is pending (feat-758).** Needs the
   privacy owner.
6. **Content and editorial (feat-763 remainder).** Empty and slug-like
   titles on the Spanish home. NUA episode labels. Raw URLs in descriptions.
   Home order for seekers on phones. First-visit context on the hero.
   These are Admin data, so report them to content owners.
7. **Subtitle `srclang` precision (#2740 follow-up).** Pass the subtitle's
   own BCP 47 tag; today `zh-Hant` becomes `zh`.
8. **Font mixed-script cost (#2834).** Revisit if analytics show many
   mixed-script or mark-bearing Latin pages.
9. **Checks no round could run.** Safari and real devices, screen readers,
   signed-in history and account, browser fullscreen Escape.
10. **Cloudflare HTML compression level.** Infra check.
11. **Merge hygiene.** README counts. #2383 (repeated hero CTA prefetch)
    needs its owner. #2626 can be closed by its owner as superseded.

## Learnings

The first three have their own solution docs in this PR:

- `docs/solutions/performance-issues/watch-client-bundle-attribution-first-module-real-bundler.md`
- `docs/solutions/ui-bugs/unicode-range-font-subsets-must-carry-combining-marks.md`
- `docs/solutions/best-practices/load-gated-media-separate-passive-start-from-viewer-intent.md`

Two more that stay in this report:

- **A capture-phase Escape handler hides inner focus restores.** If a
  dialog's capture-phase `document` keydown calls `stopPropagation()`,
  inner components never see Escape. Restore focus on the close
  transition, not in the key handler (#2837).
- **Cross-PR class pins are invisible conflicts.** A test that pins a
  class another PR deletes merges cleanly and then fails CI (#2669 ×
  #2829). Run the full suite on a local integration, not just
  `git merge-tree`.
