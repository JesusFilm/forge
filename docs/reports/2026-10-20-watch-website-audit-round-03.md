# Watch website audit — round 03: accessibility and usability

Date: 2026-10-20 (UTC 03:01–03:35). Read-only audit of production
`https://www.jesusfilm.org/watch`. Earlier rounds:
`2026-10-20-watch-website-audit-round-01.md` (PR #2821) and
`2026-10-20-watch-website-audit-round-02.md` (PR #2825).

This is not a WCAG conformance claim. Findings cite measured values. The
criteria named were checked against the W3C WCAG 2.2 Recommendation text.

## Method

- **Automated (supporting evidence):** axe-core 4.11.1 (already a repo
  dependency), with WCAG 2.0/2.1/2.2 A+AA and best-practice tags. It ran in
  headless Chromium on 13 URLs at 1280x800 and 320x640. The same script
  collected DOM facts (lang/dir, headings, landmarks, image alts,
  duplicate-name links, horizontal overflow) and a 45-step Tab walk recording
  focus indicator, visibility and coverage by fixed elements.
- **Scripted keyboard:** for the share, audio-language, subtitles, download,
  header-language, search (results and no-results) and feedback dialogs —
  Enter to open, 14 Tab and 3 Shift+Tab presses, Escape, then check whether
  focus returned to the opener.
- **Manual (native browser, T3 preview):** keyboard checks of the share,
  header-language and download dialogs, the download quality list,
  sticky-header focus visibility on a series page, and focus indicators.
- **Limits:** no screen reader, no real phone, no signed-in session.
  History/account was checked signed-out only.

## Coverage matrix

| Template / interaction      | Representative URL                              | State                          | Checks                           | Result                                                                                                                                                                                    |
| --------------------------- | ----------------------------------------------- | ------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home, en                    | `/watch`                                        | 1280, 320, reduced motion      | axe, Tab walk, DOM, motion probe | Header after footer in DOM, no skip link (open #2637); hero autoplay has no pause and ignores reduced motion (feat-762); 52 redundant card alts (feat-763)                                |
| Home, es-419                | `/watch/spanish-latin-american.html`            | 1280, 320                      | axe, DOM                         | 10 cards with empty title, link name "Mostrar "; slug-named cards (feat-763, Admin data); h1 "Ver \| Jesus Film Project" (authored data)                                                  |
| Feature film                | `/watch/jesus.html`                             | 1280, 320                      | axe, Tab walk, manual            | "Watch now" white on `#ef3340` = 4.02:1 at 18px normal (open #2669 changes CTA colours); chapter link names repeat title; "Related Questions" h2 is fine (hidden span is `display:none`)  |
| Film, RTL                   | `/watch/jesus.html/arabic-modern-standard.html` | 1280, 320                      | axe, DOM                         | `lang="ar" dir="rtl"`; only footer target-size flags                                                                                                                                      |
| Series                      | `/watch/lumo-the-gospel-of-john.html` (+ es)    | 1280, 320                      | axe, manual focus-obscured check | Sticky header does not hide keyboard focus (focused control at y=368, header bottom 68); card names repeat title (#2824 changes this card)                                                |
| Collection                  | `/watch/new-believer-course.html`               | 1280, 320                      | axe, Tab walk                    | Card heading level skip (h3 under h1 area); minor                                                                                                                                         |
| Episode                     | `/watch/lumo-john-6-1-60.html`                  | 1280, 320                      | axe, Tab walk                    | Same CTA contrast as film; at 320 the Share button was partly covered by a fixed element in the walk (round 04)                                                                           |
| Topic experience            | `/watch/family.html`                            | 1280, 320                      | axe                              | Card heading-order only                                                                                                                                                                   |
| Language inventory          | `/watch/english.html/videos`                    | 1280, 320                      | axe                              | Index numbers `#79716b` on `#151312` = 3.86:1; badge 4.02:1 (open #2669 touches this page). One 1280 run got the WordPress 404; 4 later curls returned 200 (intermittent, not reproduced) |
| Language directory          | `/watch/languages`                              | 1280, 320                      | axe                              | 895 names `#79716b` on black = 4.38:1 (open #2669 touches `WatchLanguageIndexBrowser`)                                                                                                    |
| History, signed out         | `/watch/history`                                | 1280                           | axe                              | Production still shows not-found (fixed in open #2822, not deployed)                                                                                                                      |
| What's new                  | `/watch/whats-new`                              | 1280, 320                      | axe, Tab walk                    | `<ul role="group">` breaks list semantics (11 items); labels 2.16:1–4.16:1 (feat-763)                                                                                                     |
| Not found                   | `/watch/no-such-page-r03.html`                  | 1280, 320                      | axe                              | Recovery button 4.02:1 (brand red); soft-404 status tracked in feat-757                                                                                                                   |
| Share dialog                | film                                            | keyboard                       | scripted + manual                | Pass: focus enters on Close, Tab/Shift+Tab stay inside, Escape returns to Share                                                                                                           |
| Language & subtitles dialog | film                                            | keyboard                       | scripted                         | Pass: contained, Escape returns to opener                                                                                                                                                 |
| Header language dialog      | home                                            | keyboard                       | scripted + manual                | Pass natively. Cold-load race: the dialog takes ~1 s to load, and focus sits on `<body>` until then                                                                                       |
| Download dialog             | film                                            | keyboard                       | manual                           | Dialog focus fine. **Quality list not keyboard-operable** — fixed in feat-761 (PR #2826)                                                                                                  |
| Search modal                | home                                            | keyboard, results + no-results | scripted                         | Tab leaves the modal to header controls; Escape drops focus to `<body>`. Open #2663 covers both. No-results state shows `Search in English for "…"` with no status announcement found     |
| Feedback dialog             | film                                            | keyboard (no submit)           | scripted                         | Pass                                                                                                                                                                                      |
| Player controls             | —                                               | —                              | not tested this round            | Open #2740 adds shortcuts; needs a playback pass                                                                                                                                          |
| Signed-in history/account   | —                                               | —                              | **not tested**                   | No authorised session; no impersonation                                                                                                                                                   |
| Loading/error boundaries    | —                                               | —                              | **not tested**                   | No safe local reproduction with Admin data this round                                                                                                                                     |

## Confirmed issues fixed

1. **Download quality list unusable by keyboard** (WCAG 2.2 SC 2.1.1).
   Production: Enter opened the list, but arrows did nothing and Tab skipped
   the options. Keyboard users stayed on "Highest" (5,521,959,728 bytes for
   JESUS). Fixed by rendering the shared `TierListbox` in `DownloadModal` —
   feat-761, PR #2826. On-demand chunk +1,414 B raw (~0.55 KB brotli); no
   first-load change.

## Confirmed issues already in open PRs (not duplicated)

- Header after footer, no skip link (SC 2.4.1, 2.4.3): #2637 (conflicting since 2026-10-10; needs a rebase).
- Search modal focus leaks and focus loss on close: #2663.
- CTA, footer-target and language-page contrast/target sizes: #2669.
- Player keyboard shortcuts: #2740.
- Feedback launcher RTL placement: #2752.

## New follow-ups

- feat-762 (P2): hero preview pause control and reduced-motion start (SC 2.2.2).
  The ticket file ships with its implementation, PR #2829, not with this
  report, so the two PRs do not add the same file.
- feat-763 (P3): What's new list semantics and contrast, empty/slug card
  names, redundant card alts.

## Rejected leads

- Download Terms button nested in a label: already fixed in code (not a `<label>`).
- "QuestionsRelated Questions" heading: `textContent` artefact; the hidden span is `display:none`.
- Duplicate "JESUS" h2: a visible section heading under the hero h1; not a defect.
- Sticky header hiding series language box focus: not reproduced; scroll padding keeps focus visible.
