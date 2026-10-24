# Watch website audit, round 02: persona journeys and jobs to be done

Date: 2026-10-20 (UTC). Scope: the public Watch site (`apps/web`) on
production `https://www.jesusfilm.org/watch`, walked read-only in a clean
browser profile at 1280x800 and 390x844. Partner and next-step destinations on
the root site were opened read-only where a journey reached them; they are not
built from this repository and are marked "outside Forge".

The four personas are working hypotheses for a heuristic review. They are not
findings from user research or interviews, and they make no claim about what
any real visitor believes. No form, vote, download, donation or account action
was submitted.

Round 01 (`2026-10-20-watch-website-audit-round-01.md`, in PR #2821) covered
templates and page-load performance.

## Personas and jobs to be done

### Unbeliever: a curious visitor who needs context

- **Situation:** follows a shared link or a search result for "Jesus movie",
  with no church background.
- **Motivation:** understand what this is before giving it time.
- **Desired outcome:** knows what the film or video is, watches some of it in
  their own language, and leaves without pressure.
- **Success criteria:** the subject and length are clear in seconds; playback
  starts with no account; the page reads correctly in their language.
- **Barriers seen:** the home hero rotates single segments ("LUMO - John
  4:1-54", "Parable of the Lamp") labelled only "Segment"; the page `h1` sits
  below the first screen (y≈953 px desktop, ≈990 px mobile); the film page
  shows no synopsis above the fold (it starts about 790 px down).
- **Current path:** `/watch` hero → "Watch Now" → segment page; or category
  "The JESUS Film" → `/watch/jesus.html` (128 min, 2,296 audio languages, 61
  chapters, description, transcript).

### Seeker: someone looking for answers

- **Situation:** has a question ("is God real?", "is Jesus real?") and is
  weighing Christianity.
- **Motivation:** honest answers without being sold to.
- **Desired outcome:** finds a short video that addresses the question, then
  a way to ask a person.
- **Success criteria:** search or the home page surfaces question-led videos;
  results explain why they match; a human next step is visible.
- **Barriers seen:** searching `is god real` did not return the home page's own
  "Is Jesus Real? (Episode 2)" or the "Questions Are Welcome Here" series in
  the first 10 results; one result's snippet was caption noise
  (`[MUSIC] [INAUDIBLE] …`, feat-760); on a phone "Questions Are Welcome Here"
  starts about 5,000 px down.
- **Current path:** header search → results grid; or home → "Questions Are
  Welcome Here" → `/watch/nua-fresh-perspective.html`; film page "Related
  questions" → "Ask yours" (opens Issues I Face, outside Forge, new tab).

### Believer: learning and sharing

- **Situation:** a Christian who wants to grow, or to share a video with a
  friend or small group, often in another language.
- **Motivation:** good material they can trust and pass on.
- **Desired outcome:** follows a course or series in order and shares a link
  in the friend's language.
- **Success criteria:** series show order and progress; language switching
  keeps the place; shared links open in the chosen language.
- **Barriers seen:** on localized series pages, card labels were English
  ("EPISODE 1" inside "SERIE · 22 EPISODIOS") — fixed in PR #2824 (feat-759);
  NUA episodes 1–8 are containers labelled "Series" inside a "10 episodes"
  series; series descriptions show raw URLs and social handles.
- **Current path:** home → "New to Christianity? Start Here." →
  `/watch/new-believer-course.html` (10 episodes, rail "Episode 1 of 10") →
  Share (link, Facebook, X, embed code); language dialog → URL that names the
  language.

### Partner: a ministry or organization distributing content

- **Situation:** a church, mission or ministry preparing a screening, an
  offline device or a website embed.
- **Motivation:** reliable files and embeds in many languages, plus training
  and equipment.
- **Desired outcome:** downloads the right file size, embeds a player, and
  finds partner resources.
- **Success criteria:** the file size is known before downloading; language
  and quality are clear; partner resources are one click away.
- **Barriers seen:** the single-video download defaults to "Highest" with no
  size shown — for JESUS that is 5.52 GB (High 2.96 GB, Low 585 MB); the
  download language is fixed to the page language; the footer's "Share" and
  "Resources" both redirect to the same `/resources` page (outside Forge).
- **Current path:** film page → Download → size tier + Terms → file; Share →
  Embed code; footer → Partners (WordPress) or Resources (`/resources`, a
  separate Next.js app, outside Forge).

## Journey steps and health

| #   | Step                                     | Persona            | Health   | Evidence                                 |
| --- | ---------------------------------------- | ------------------ | -------- | ---------------------------------------- |
| 1   | Land on `/watch` (desktop)               | all                | Fair     | hero is a segment; `h1` below the fold   |
| 2   | Open the JESUS film page                 | unbeliever         | Good     | length, languages, chapters, Share       |
| 3   | Read about the film, related questions   | unbeliever, seeker | Good     | description, questions, "Ask yours"      |
| 4   | Search "is god real"                     | seeker             | Fair     | caption-noise snippet; NUA not in top 10 |
| 5   | Open "Questions Are Welcome Here" series | seeker             | Fair     | episodes 1–8 labelled "Series"           |
| 6   | Start the New Believer Course            | believer           | Good     | 10 episodes, ordered rail                |
| 7   | Switch language                          | believer, partner  | Good     | dialog navigates to a language URL       |
| 8   | Browse a Spanish series                  | believer, partner  | Poor→fix | English card labels (PR #2824)           |
| 9   | Share a video                            | believer           | Good     | link, Facebook, X, embed code            |
| 10  | Download the film                        | partner            | Fair     | 5.52 GB default, no size shown           |
| 11  | Find partner resources                   | partner            | Fair     | duplicate footer links; outside Forge    |
| 12  | Home on a phone                          | all                | Fair     | seeker sections 5–6 screens down         |

## Fixed in this round

- **PR #2824 (feat-759):** series episode cards read `VideoLabels` from the
  page's catalog, so a Spanish series shows "Episodio 1", "Serie",
  "Colección". Tests pin the Spanish output; matched builds show +11 bytes of
  client JS.

## Unfixed gaps, prioritized

1. **Download size before a 5.5 GB download (product decision).** Single-video
   tiers show only Highest/High/Low and default to Highest. File-size labels
   were removed on purpose in feat-310 (PR #1740), when sizes were unreliable;
   Admin now supplies sizes (`data-size-bytes` on each option). Owner: Web/Watch,
   `apps/web/src/components/watch/DownloadModal.tsx`. Recommendation: decide
   whether to show sizes again or default to a smaller tier on phones.
2. **Search snippet caption noise (feat-760).** Admin returns transcript chunk
   text as the snippet. Owner: `apps/admin/src/services/watch-search.service.ts`.
3. **Question-led search relevance.** `is god real` misses the curated NUA
   question series. Owner: Admin search (`Query.watchSearch`); judge with the
   Mastra search-eval contracts before changing ranking.
4. **Seeker sections deep on mobile.** The home order comes from the authored
   homepage Experience (`watchSetting.homepageExperience`), so this is an
   editorial choice; Spanish home has no "New to Christianity" or FAQ block.
   Owner: content editors in Admin.
5. **Context for first-time visitors.** Hero segments carry no synopsis, and
   the `h1` is below the fold (round 01). Owner:
   `apps/web/src/components/home/*`; needs a design decision.
6. **Container labels in NUA.** Episodes 1–8 are labelled SERIES in Admin data
   while titled "(Episode N)". Owner: Admin content data.
7. **Raw URLs in descriptions.** Core descriptions include URLs and social
   handles (LUMO John, Know God). Owner: content data; a linkify or trim rule
   would be a separate web decision.
8. **Footer partner links (outside Forge destinations).** "Share" and
   "Resources" both 301 to `/resources`; that page's title is
   "Watch | Jesus Film Project" and its headings start at `h4`. The footer's
   "Give Now" link carries `thankYouRedirect=/dev/special/thank-you-refer/social-share/`;
   confirm with the giving team that this path is intended. Link owner:
   `apps/web/src/components/home/WatchHomeFooter.tsx`; destination owners: root
   site teams.
9. **Layout overlaps (for the design and mobile round).** The feedback button
   covers card text at 390 px; the sticky header covers the series language
   box while scrolling.

## Strengths worth keeping

- Free with no account; the home FAQ says so plainly.
- Film pages expose length, quality, 2,296 audio languages, chapters,
  transcript, related questions and a Bible-study next step.
- Language changes navigate to a URL that names the language, and the dialog
  links to "See all videos in English".
- Share offers a link, social targets and embed code; series offer a
  collection download.

## Limits

- One clean session per viewport; no signed-in, history or download-completion
  checks, and no screen-reader or keyboard pass (round 03).
- Personas are hypotheses, not research. Relevance claims rest on one query.
- Root-site pages were read, not audited in depth.
