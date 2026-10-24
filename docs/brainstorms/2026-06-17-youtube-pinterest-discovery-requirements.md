# Requirements: YouTube + Pinterest AI-Christian video discovery → website review queue

Created: 2026-06-17
Status: ready for planning
Owner: Lyuba (with Vlad on the website/deploy side)
Builds on: docs/brainstorms/2026-06-11-instagram-ai-christian-discovery-requirements.md

## Problem & Goal

The Instagram discovery bot is live: it finds AI-generated Christian videos and
feeds them into a human-approved review queue on gospelmedialab.com, where
approved videos appear in the Inspiration Feed. The original vision always
included **YouTube and Pinterest** next, reusing the same approval/feed
machinery — in fact most of the team's curated creators are on YouTube
(Instagram was built first only because it is the hardest to pull from).

**Goal:** extend discovery to **YouTube and Pinterest**, pulling AI-generated
Christian videos from a list of trusted creators _and_ from keyword search, into
the **same** review queue and feed the Instagram bot already feeds.

## Decisions resolved in this brainstorm

- **Filter every video, even from trusted accounts.** Being on the trusted list
  prioritizes a creator, but each video still passes the AI + Christian check
  (same bar as Instagram). Protects against a trusted creator's occasional
  off-topic post.
- **Both modes from the start, per platform:**
  1. **Trusted accounts** — pull recent videos from known-good YouTube channels
     and Pinterest boards.
  2. **Keyword discovery** — search each platform for new creators not yet on
     the list (like the Instagram bot's discovery mode).
- **Pinterest is in scope as a real video source.** The trusted creators post
  native video pins that play on Pinterest itself (not just images linking out).
- **Manage the trusted-account list on the existing review page.** A new
  **"Sources"** section on the same secret review page: paste a YouTube channel
  or Pinterest board link to add it, remove with a click. No developer needed.
- **One workflow per platform** (a YouTube workflow and a Pinterest workflow),
  each mirroring the proven Instagram workflow, with the shared steps
  (AI+Christian filter, duplicate-removal, website submission) reused as common
  building blocks rather than duplicated.
- **Build order: YouTube first, then Pinterest.** YouTube is the easiest to pull
  from and where most good content already is; Pinterest is the most locked-down
  and most fiddly, so it follows without blocking YouTube.
- **Human approves everything.** No auto-publishing (unchanged from Instagram).

## Attribution requirement (applies to all platforms, including Instagram today)

Every video preview in the review queue and the public feed must show:

- the **account / author** (e.g. `@231worship`),
- the **platform** it came from (Instagram / YouTube / Pinterest),
- with the **author name as a clickable link to the original post/source**
  (opens the real video on its platform).

**Current bug to fix:** on the live Instagram review preview the attribution line
shows (`@231worship · Instagram`) but the handle is **not a working link**. The
clickable-source behavior must work on the existing Instagram page too, not only
the new platforms. The discovery bots therefore need to capture and pass through
a reliable source URL (and author handle/URL) for every video.

## Desired end-state

For each of YouTube and Pinterest, a workflow that:

1. Pulls recent videos from the trusted accounts for that platform.
2. Also keyword-searches the platform for new creators.
3. Merges both sources and removes duplicates.
4. Runs the AI + Christian filter, dropping commentary/reaction/tutorial posts.
5. Skips anything already approved or rejected (memory — no repeats).
6. Submits the survivors to the same review queue, tagged with their platform
   and a working source link.

The reviewer sees one combined queue (Instagram + YouTube + Pinterest), each item
showing platform + clickable author, and approves the good ones into the feed.

## Success criteria

- Trusted YouTube channels and Pinterest boards can be added/removed from the
  review page without a developer.
- Running each workflow produces fresh AI-Christian video candidates in the
  review queue, tagged by platform, with a working clickable source link.
- No duplicates across runs or across platforms (same video never queued twice).
- Approving a YouTube or Pinterest video makes it appear in the public feed with
  correct platform + author attribution.
- Instagram continues to work unchanged, and its attribution link now works.

## Scope boundaries

**In scope:** YouTube + Pinterest discovery (both modes); a "Sources" management
section on the review page; a platform label + working source/author link
through the whole pipeline; fixing the Instagram attribution link.

**Deferred for later:** a 4th platform; auto-publishing; analytics on which
sources convert best; bulk-approve tooling.

**Outside this product's identity:** anything that publishes to the public site
without human approval.

## Dependencies / open questions for planning

- **Website changes (Vlad):** review queue must accept a `platform` field and a
  source/author link; add the "Sources" management section; render attribution
  with a working clickable author link (and fix it for existing Instagram items).
- **Platform access (for planning, not decided here):** YouTube has a free
  official API (clean). Pinterest is the most restricted — planning must confirm
  how trusted-board video pulling and keyword search are technically achieved
  (official API approval vs web-search fallback like Instagram). This is the
  main feasibility unknown.
- **Volume target:** Instagram's working target was ~3-5 approved/day. Confirm
  whether adding platforms raises that target or just diversifies the supply.
- **Trusted-account starting list:** Lyuba to provide the initial YouTube
  channels and Pinterest boards.
