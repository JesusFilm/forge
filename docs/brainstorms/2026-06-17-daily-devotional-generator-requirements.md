# Requirements: Daily devotional generator (Mastra workflows)

Created: 2026-06-17
Status: ready for planning
Owner: Lyuba
Related: docs/roadmap/platform/feat-067-doctrinal-validation-engine.md (doctrinal check),
docs/roadmap/topic-experiences/feat-039-topic-discovery-programming-engine.md (programming engine)

## Problem & Goal

We want a daily, engaging, scripture-centered **devotional** that feels _current_ —
tied to what's happening in the world right now — published automatically to a
"Today's Devotional" page on the **Jesus Film Watch experiment site** (the team's
copy of the watch website used for experiments).

A devotional should feel fresh and timely, anchor on a real portion of scripture,
include a relevant clip from the Jesus Film video library (video-as-scripture),
and end with reflection that invites the reader in. It should be reliable in its
theology because it draws on trusted ministry partners' teaching.

**Goal:** a set of Mastra workflows that produce and publish one devotional per
day, with minimal human effort, that a reader experiences as timely, biblically
grounded, and visually anchored by Jesus Film video.

## The daily devotional — what it contains

Every devotional includes these ingredients:

1. **A hook** — a reason this devotional matters _today_. Priority order:
   - **Timely world news** (prominent — the main hook most days),
   - a **holiday / Christian-calendar** moment,
   - else an **intriguing question** or evergreen angle.
2. **A scripture passage** — a small, focused portion for the day.
3. **A Jesus Film video clip** — a genuinely relevant clip found via search across
   the **whole Jesus Film video library** (not only the JESUS film). The clip is
   treated as "video scripture" and is a first-class element.
4. **An original reflection** — short, clear, engaging, written in our own words,
   **grounded** in trusted partner teaching (never republishing theirs).
5. **Reflection questions** — a few questions that invite the reader to respond.
6. **Optional "further reading"** — a link out to a partner piece.

### Flexible structure (not a fixed daily template)

The ingredients are always present, but their **order and emphasis vary day to
day** so it never feels formulaic. Some days the **video clip opens** (lead with
video-scripture, then hook, then reflection); other days the **hook opens** (news
→ scripture → clip → reflection). The generator should compose a coherent
arrangement per day rather than stamp the same skeleton every time.

## Decisions resolved in this brainstorm

- **Destination:** a "Today's Devotional" page on the Jesus Film Watch experiment
  site.
- **Publish flow:** **auto-publish with a safety net.** It generates and publishes
  daily after an automated **doctrinal + tone/sensitivity check**; a human can
  **pull or edit** any day after. No required daily approval task.
- **News is prominent** and, for this experiment, news days **also auto-publish**
  (Lyuba's call: ship it, observe, add filters or human approval later if risky).
  This makes the automated sensitivity check load-bearing (see Risks).
- **Partner material = grounding only.** The bot reads partner teaching for
  reliable theology, then writes an **original** devotional; it may **cite/link**
  a partner piece as further reading, but **never republishes** their content.
- **Video = whole Jesus Film library, always a clip.** Use search across the full
  library so almost any scripture can be paired with a relevant clip. (The admin
  side already has semantic search over the video catalog to reuse.)
- **Flexible per-day structure** (above).
- **Cadence:** one devotional per day, scheduled, auto-published.

## Success criteria

- Each day, a new devotional appears on the Today's Devotional page without manual
  work, containing all six ingredients.
- The devotional reads as **timely** (connects to a real current hook) and
  **biblically grounded** (real passage, reliable theology).
- Every devotional has a **relevant** embedded Jesus Film clip.
- Day-to-day **structure varies** — a reader checking several days running sees
  different arrangements, not one template.
- The reflection is **original** (not partner text); partner links, when present,
  are clearly "further reading."
- The safety check **blocks or flags** devotionals that are doctrinally off,
  tonally wrong, or politically charged before they publish.
- A human can **pull or edit** any published day quickly.

## Scope boundaries

**In scope:** the daily generation + auto-publish pipeline; the four hook types;
original reflection grounded in partners; library video matching; reflection
questions; the automated doctrinal + sensitivity safety check; the Today's
Devotional page on the experiment site.

**Deferred for later:**

- **Multilingual devotionals** (English first; the video library is already
  multilingual, so localization is a natural follow-up).
- **Restrictions / human approval for news days** — added if the experiment shows
  the automated check isn't enough.
- An **archive / past-devotionals** browsing experience (start with just "today").
- **Email / social** distribution of the devotional.
- Reader interaction (saving, sharing, answering reflection questions on-site).

**Outside this product's identity:** republishing partner content; publishing
anything the safety check has rejected; taking a partisan political position.

## Dependencies / open questions for planning

- **News source.** How does the bot learn "today's important world news"? (A news
  API, a search, a curated feed?) Needs a reliable, filterable source — decide in
  planning. The sensitivity of this choice is high.
- **Video library search.** Confirm how the bot queries the Jesus Film library for
  a clip matching a scripture/topic (reuse admin semantic search vs. another API),
  and the **fallback** when no genuinely relevant clip is found (a sensible default
  clip vs. accept a weaker match vs. skip video that day).
- **Safety check design.** What does the doctrinal + tone/sensitivity check
  actually evaluate, and what's its pass/block/flag behavior? (Roadmap feat-067
  doctrinal-validation-engine may inform this.) This is the load-bearing guard.
- **Scripture selection.** How is the daily passage chosen so it coheres with the
  hook _and_ has a matchable video — does the hook drive the passage, or vice
  versa, day to day?
- **Page + storage.** Where/how the Today's Devotional page reads the day's
  content on the experiment site (content store, scheduling/cron).
- **Partner grounding sources.** Which partner materials are actually reachable
  (public sites, feeds) for the bot to read as grounding, and how.

## Risks

- **The safety net is the only gate (by design, for the experiment).** Prominent
  news + auto-publish means a tone-deaf or off-doctrine devotional could go live
  before any human sees it, on a Jesus Film-branded page. Mitigation: a genuinely
  strict automated doctrinal + sensitivity check, an easy pull/edit, and a
  documented escalation to human approval (or disabling news) if it misbehaves.
- **Always-a-clip can force weak matches.** If the library search can't find a
  truly relevant clip, forcing one in hurts quality. Mitigation: a defined
  fallback (see open questions).
- **"Timely" can age badly.** A devotional tied to a fast-moving event can look
  stale or wrong hours later. Mitigation: short shelf life (it's "today's"), easy
  pull.
