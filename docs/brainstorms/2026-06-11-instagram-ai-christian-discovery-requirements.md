# Requirements: Instagram AI-Christian content discovery → website Inspiration Feed

Created: 2026-06-11
Status: ready for planning
Owner: Lyuba (with Vlad on the website/deploy side)

## Problem & Goal

gospelmedialab.com has an "Inspiration Feed" that showcases AI-made Christian
creators' work (Instagram, Pinterest, YouTube). Today that feed is curated by
hand. We want a bot that continuously surfaces fresh **AI-generated Christian
videos from Instagram**, so a person can quickly approve the good ones into the
feed.

**Concrete goal:** about **3-5 approved posts per day** (treat as an average
with a buffer, not a hard daily quota — supply is finite some days).

**Why Instagram first:** most of the team's curated sources are on YouTube
because Instagram is the hardest platform to pull from. The team has chosen to
build the **hard platform (Instagram) first**, then add YouTube and Pinterest
later, reusing the same approval/feed machinery.

## What exists today (already built and deployed)

- A Mastra workflow `instagram-ai-christian-discovery` (in the Forge repo,
  `apps/mastra`) that:
  - searches the open web via Firecrawl for Instagram posts,
  - keeps posts whose caption/hashtags match **both** an AI keyword and a
    Christian keyword,
  - dedupes by post link, and returns a list + saves a JSON report.
- It is deployed and confirmed working on the server (real results returned).
- Operated manually today by running it in Mastra Studio.

This covers the "discover new creators" half of the vision. It is noisy by
design (keyword matching), which is why human approval is required.

## Desired end-state (the full picture)

A two-mode Instagram bot feeding a human-approved website feed, with memory:

1. **Priority mode — follow trusted accounts.** The user maintains a list of
   Instagram accounts known to make good AI-Christian content. The bot pulls
   these accounts' recent posts and prioritizes them.
2. **Discovery mode — find new creators.** Keep the existing keyword web search
   to surface accounts not yet on the list.
3. **Combine → clean → queue.** Merge both sources, remove duplicates, drop
   obvious news/tutorial posts, and place candidates in a review queue.
4. **Memory (no repeats).** The bot skips anything already approved or rejected,
   so each run shows genuinely new posts. Essential for a daily rhythm.
5. **Approve.** A person reviews the queue on an admin page and approves/rejects.
6. **Display.** Approved posts appear in the gospelmedialab.com Inspiration Feed.

## Key decisions (resolved in brainstorm)

- **Human approves before anything goes public.** No auto-publishing to the site.
- **Approval lives on an admin page** on gospelmedialab.com (the team is building
  that admin area anyway for video templates, so post-approval is one more
  section there).
- **Connection is automatic** via the site's database (the site already has a
  designed-but-currently-inactive Postgres/Prisma layer with a `ContentItem`
  table). The same database is both the approval store and the bot's "memory."
- **Two discovery sources, not one:** trusted-account follow-list (priority) +
  keyword discovery (new creators).
- **Quality bar is "good enough to gather," not "perfect."** The human approval
  click is the quality gate; do not over-invest in making raw bot output perfect.

## Findings that shape scope (verified during testing)

- **Web search cannot target specific accounts.** Putting `instagram.com/<handle>`
  in a search query was tested live and returned generic trend posts, not the
  named accounts' content; author handle came back empty. Therefore the
  follow-list (priority mode) **cannot** be built on Firecrawl web search.
- **Following specific Instagram accounts needs a real Instagram data source.**
  Instagram blocks reading profiles directly. Reliably fetching a public
  account's recent posts typically requires a dedicated third-party Instagram
  data/scraper service. This carries a **cost** and a **terms-of-service gray
  area** the team should accept knowingly. This is the "hard part" being
  tackled first.
- **Author/date/thumbnail are usually empty in search-only mode.** The website
  shows posts by their Instagram link (an embed), which fills in image, author,
  and caption automatically, so empty fields do not hurt display. But they do
  limit filtering by author, which is another reason the follow-list needs a
  proper source.
- **Duplicates slip through** when the same video is re-posted under different
  links (different link = the current dedupe misses it). Also, a single viral
  trend can flood results with near-duplicates.
- **No cross-run memory today.** Each run is independent, so repeated runs
  re-find the same popular posts. The shared database is what fixes this.

## Requirements

- R1. **Follow-list (priority).** User can maintain a list of Instagram accounts;
  the bot fetches their recent posts and prioritizes them in the queue.
- R2. **Discovery (new creators).** Keep keyword web search for accounts not on
  the list.
- R3. **Merge + dedupe.** Combine both sources and remove duplicates, including
  the same video re-posted under different links (dedupe by caption as well as
  link), and near-duplicate trend clones where feasible.
- R4. **Quality filtering.** Automatically drop obvious news/tutorial/commentary
  posts; keep actual creations. (A smarter AI-based relevance check is a likely
  later upgrade.)
- R5. **Memory.** Skip posts already approved or rejected; only show new ones.
- R6. **Review queue + approval.** Admin page on gospelmedialab.com to review
  candidates (with thumbnail, caption, link, why-it-matched) and approve/reject.
- R7. **Display.** Approved posts appear in the Inspiration Feed.
- R8. **Runs automatically each day** (scheduled), so a fresh queue is waiting.
- R9. **Sensible cost controls** (search count, run frequency, and any paid
  Instagram source) agreed with the team.

## Success criteria

- A person can approve ~3-5 fresh posts per day from the queue, on average.
- Repeated runs do not re-show already-decided posts.
- Approved posts show up in the Inspiration Feed without manual copying.
- Trusted accounts reliably appear in the queue (priority mode actually works).

## Scope boundaries

**In scope (now):**

- Instagram, both modes (follow-list + discovery), memory, approval, feed display.

**Deferred for later:**

- YouTube sources (the QBIBLE playlists + Shorts channels) — easiest platform,
  add after Instagram works.
- Pinterest boards.
- Smarter AI relevance check (beyond keyword + commentary filter).
- Multi-language handling (the source list spans es/pt/ru/hi/ar/zh/en; the
  `ContentItem` table already has a `locale` column).

**Out of scope:**

- Auto-publishing without human approval.
- Building our own Instagram crawler that defeats Instagram's login wall.

## Dependencies & open questions (for planning)

1. **Choose an Instagram data source** for the follow-list (priority mode):
   which third-party service, its cost, reliability, and ToS posture. This is
   the main new technical decision.
2. **Turn on the site's database** (set `DATABASE_URL`); confirm the
   `ContentItem` schema fits posts + approval status + "seen" memory.
3. **Where the bot and site connect:** bot writes candidates to the site (likely
   a small protected endpoint), candidates land as "pending."
4. **Scheduling:** how/where the daily run is triggered.
5. **Cost ceiling:** agree on search volume, run frequency, and paid-source
   budget.

## Trusted Instagram accounts (initial follow-list)

From the team's source list (`instagram_accounts_offline`):

| Handle                 | Language | Notes                                              |
| ---------------------- | -------- | -------------------------------------------------- |
| `_secretosdela_biblia` | es       | Spanish Bible AI                                   |
| `vlog.biblico`         | pt       | Brazilian Veo 3 Bible POV vlogs (Klelvem Barcelos) |
| `ulyanasaleeva`        | ?        | —                                                  |
| `biblewithlife`        | en       | Dezheng Yu, Christian visual Bible storytelling    |
| `andhikaramadhian`     | en       | —                                                  |
| `kevincardenart`       | en       | —                                                  |
| `the_aimedialab`       | en       | the lab's own account                              |

(YouTube playlists/channels and Pinterest boards from the same list are deferred
to later platform work.)

## Suggested build order

1. Turn on the site database; confirm schema for candidates + approval + memory.
2. Connect the existing discovery bot to write candidates into that database
   (gives an end-to-end slice with what already works).
3. Admin approval page (review queue → approve/reject, writes back to DB).
4. Inspiration Feed reads approved posts.
5. Memory: bot skips already-decided posts (reads DB before queueing).
6. Quality + speed fixes in the bot (caption dedupe, drop commentary, run
   searches in parallel with a time limit).
7. Follow-list (priority mode): integrate the chosen Instagram data source.
8. Daily schedule.
9. Later: YouTube + Pinterest sources; smarter AI relevance check.
