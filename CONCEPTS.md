# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Video & media

### Smart Crop

A Manager-orchestrated media-generation workflow that produces 9:16 vertical
crop plans and renders from widescreen Mux videos. Manager owns durable job
state and operator review, Mastra owns bounded AI crop decisions, and
crop-worker owns FFmpeg fingerprint/render byte work.

### Core ID

The stable identifier from the Core API for a Core-sourced entity. For source
video attribution, `Video.coreId` is the canonical video answer and
`VideoDub.coreId` is Core's `videoVariantId`.

### Video

A piece of watchable content — a feature film, a segment of one, or a container node (series, collection) in a parent/child tree. A Video is not directly playable on its own: its watchable audio comes from its Dubs and its subtitles from a Video Edition. Videos relate to each other as parents and children, which is how series and their episodes — and "Up Next" siblings — are formed.

### Dub

One audio-language variant of a Video — the unit the watch screen's language picker selects (a popular title can have thousands of Dubs). A Dub carries its own playable stream and its own set of downloadable renditions, and points at the Video Edition whose subtitle tracks apply to it.
_Avoid:_ variant (the mobile client aliases Dubs as "variants").

### Video Edition

A cut/edition of a Video that owns the subtitle tracks. Subtitles hang off the Edition, not off individual Dubs — a Dub references the Edition whose subtitles apply, so many Dubs sharing an edition share one set of subtitle tracks.

### Language

A language a Video is offered in: every Dub is for one Language, and subtitle tracks are per-Language. A Language has two identifiers that are easy to conflate — a unique, stable slug that is its identity (e.g. korean, kurmanji-standard), and a BCP-47 tag that is a locale label (e.g. ko, ko-kmr) and is deliberately not unique per language, so distinct Languages can share a tag or its prefix. Identity comparisons — persisting or re-selecting a user's chosen language — key on the slug; the BCP-47 tag is only for best-effort device-locale matching.

## Video source mapper

### Video Source Mapper

A prototype attribution service that accepts an externally uploaded or reuploaded video and maps it back to the official source Video and likely Dub it came from.

### Mapper Catalog

A mapper-owned projection of official Forge/Admin media records and matchable media signals used for attribution. The Mapper Catalog is an index for matching, not the source of truth for Videos, Dubs, or Video Editions.

Mapper Catalog rows are shaped around matchable variants: the source Video
identity stays anchored by Core ID, while each Dub contributes the variant
identity the mapper uses to compare uploaded media against official media.

### Catalog Sync Run

A durable record of one Mapper Catalog refresh from Admin into mapper-owned
projection rows.

A Catalog Sync Run tracks page progress, counts, terminal status, and safe
failure summaries so broad catalog refreshes can be inspected and retried
without treating Admin as the mapper's database.

### Media Signature

A compact, versioned media signal derived from an official catalog variant and
stored for future content-first retrieval.

A Media Signature is keyed by the source `coreId`, the variant
`videoVariantId`, signature type, algorithm version, and time offset. It is
evidence for matching, not catalog metadata.

### Index Run

A durable record of one pass that turns indexable Mapper Catalog variants into
Media Signatures.

An Index Run tracks algorithm version, cursor, counts, terminal status, and
safe failure summaries so broad indexing can be resumed or inspected without
reprocessing the whole catalog.

### Match Job

An asynchronous attribution request that owns an uploaded media input until the mapper can process it and return ranked results.

A Match Job moves from queued to running only after a worker or operator claims
it. Stale running jobs can be reclaimed so a crashed process does not leave the
request permanently stuck.

### Match Job Worker

The mapper process-local consumer that claims queued or stale running Match Jobs
and processes them through the same attribution path used by operator recovery.

The worker is intentionally bounded: it handles one Match Job at a time in a
service process, preserving the durable queue semantics without adding an
external queue service.

### Expired Match Job

A Match Job that remained queued past the yt-video-mapper queue expiry window
without being claimed by a worker or operator.

An Expired Match Job is terminal: its raw upload is removed, but its lightweight
job row remains pollable until normal result retention so callers can distinguish
queue expiry from an unknown job.

### Match Job Cleaner

The yt-video-mapper cleanup process that expires abandoned queued Match Jobs and
removes their raw uploads independently of client polling.

The cleaner owns queue-age expiry only; running-job recovery remains the Match
Job Worker's stale-running reclaim path.

### Match Candidate

A ranked possible attribution produced by a Match Job, pairing a source Video with its likely Dub and a confidence judgment.

### Source Anchor Evidence

Match evidence that supports which source Video an uploaded media input came
from, before deciding which Dub or language-specific variant is most likely.

Visual or structural media evidence usually acts as Source Anchor Evidence
because re-upload metadata, audio language, and transcript text can drift while
the underlying source footage stays recognizable.

### Variant-Ranking Evidence

Match evidence that helps choose the likely `videoVariantId` after Source
Anchor Evidence has narrowed the source Video.

Audio, text, language, and subtitle signals are usually Variant-Ranking
Evidence: they can distinguish Dubs under the same source, but should not create
a high-strength source attribution on their own.

## Search & embeddings

### Search Pipeline Mode

A request-side selector that chooses which retrieval pipeline Admin search should run for a caller. A Search Pipeline Mode changes how candidates are gathered and fused; it is not a health signal.

### Search Candidate Window

A bounded per-retriever set of eligible search candidates that is handed to
fusion after retrieval-specific ranking and filtering. Eligibility gates that
affect whether a result can appear must run before the window; display-only
hydration should run after the window so it cannot multiply or reorder
candidates.

### Search Eval Caller Track

A search-evaluation prompt group scoped to a caller's job rather than only to a
retrieval mode. Public Watch search, AI experience generation, and semantic
diagnostics can each have different prompt intent and success criteria, even
when they run against the same Search Pipeline Modes.

Current caller tracks are `public-watch`, `ai-experience-generation`, and
`semantic-diagnostic`. `public-watch` is the launch-readiness lens for the
viewer-facing Watch search bar and defaults to Keyword-First Search.
`ai-experience-generation` is for agents selecting videos while building
devotionals, experiences, or related-content sections and defaults to Hybrid
Search. `semantic-diagnostic` isolates semantic retrieval quality and only runs
with Semantic-Only Search.

### Search Language

The language semantic search uses to interpret and match a query. Search Language is separate from UI locale, public Watch route language, and audio-language selection: changing it affects search results but does not change the viewer's website language, URL language segment, or selected Dub.

Search Language identity should travel as the public language slug selected or confirmed by the viewer. Locale tags are useful for fallback negotiation and search execution, but they are not the exact identity of the viewer's chosen search language.

### Query Language Suggestion

A visible search-bar suggestion produced when the typed query appears to be in a supported language different from the current Search Language. The suggestion can be generous because it is confirm-gated: it does not change Search Language until the viewer accepts it, and unsupported or unrecognized queries leave the current Search Language in control.

### Keyword-First Search

A Search Pipeline Mode that keeps semantic retrieval available while strengthening lexical and title-driven retrieval so exact or near-title matches are not diluted by broad semantic similarity.

### Semantic-Only Search

A diagnostic Search Pipeline Mode for eval runs that isolates semantic/vector retrieval by excluding keyword, title, and full-text candidate retrieval.

Semantic-Only Search is for measuring whether Content Embeddings can find relevant content without lexical retrieval helping the result set. It is not a public Watch search behavior unless a separate product decision makes it one.

### Search Degradation Signal

The response-side state that says whether semantic retrieval actually contributed to a search response. It reflects runtime embedding availability, not the requested Search Pipeline Mode.

### Content Embedding

A vector representation of localized content used for semantic retrieval across videos, scenes, transcripts, and experiences. Content Embeddings are only comparable when the query vector and stored document vectors come from the same provider contract and transform behavior.

### AI Gateway

The project-owned embedding provider surface that produces vectors for Content Embeddings. AI Gateway health proves provider availability, not that Admin can launch or store a specific embedding backfill through Mastra.

### Embedding Provenance

The metadata that says which provider contract produced a stored Content Embedding and how that vector was transformed before storage. Provenance is part of search correctness: it prevents legacy vectors, newly generated vectors, and future provider variants from being treated as the same embedding space.

### Provider-Bound Gate

An evaluation or backfill approval artifact that binds quality evidence to a specific embedding provider contract before high-churn content vectors are rewritten. A Provider-Bound Gate needs both configuration provenance and corpus provenance: it must show what the system is configured to generate and what stored rows the evaluation actually searched.

### Semantic Evidence

The content fragment that explains why a search result matched a query, such as a scene description or transcript chunk. Semantic Evidence belongs to retrieval, ranking, debug context, and optional timecodes; consumer card surfaces should render display metadata unless they are intentionally showing match context.

### Manager Artifact

A source-side output from Manager's media-processing pipelines that Admin can consume to build or rebuild search indexes.

Manager artifacts are repair inputs, not the same thing as Admin's searchable vector rows.

### Transcript Chunk

A searchable segment of a video transcript stored separately from the transcript parent so retrieval and embedding workflows can operate at segment granularity.

Deleting transcript chunks removes Admin's transcript search index for those segments but does not delete the transcript identity or Manager's source artifacts.

### Source Transcript Scripture Correction

A Manager enrichment quality pass that runs after transcription and before
downstream transcript consumers. Mastra identifies high-confidence Bible-story
ASR drift, Manager applies only deterministic exact-match corrections to the
canonical source transcript/subtitle artifacts, raw artifacts are preserved,
and a correction report highlights applied and flagged findings for review.

### Embedding Backfill

A controlled batch process that generates or regenerates vectors for existing content without changing the underlying source content.

For large corpora, an Embedding Backfill's completion state should be judged
from stored embedding provenance and healthy vector rows, not from the lifetime
of the trigger request that started it. Resume flows should preserve already
healthy embeddings and continue from missing, legacy, or incomplete rows.

## Known-caller auth

### Search Passport

The request-level check on the public search surface that asks "are you a known caller?" rather than "what may you do?". Any key from any known-caller class satisfies it, and it grants no data permissions — a passport identifies the caller class, nothing more. Distinct from editor/session auth.

### Consumer Bearer

A known-caller key issued to a consumer-facing app surface (web, mobile, TV) that satisfies the Search Passport while carrying no permissions beyond public access. Each surface holds its own dedicated key so revocation and rotation stay per-surface.

A Consumer Bearer doubles as the request's Rate-Limit Identity: every request presenting the same key spends one shared budget. That is correct for a single-egress server and hazardous for a Fleet Client — on a fleet, the key must ride only on the operations the server actually gates.

### Rate-Limit Identity

The identity a request's rate budget is counted under: an authenticated user's own identity, else the presented Consumer Bearer's key, else the caller's network address. Which identity a request lands on determines whose budget it spends — a shared key pools many callers into one budget, while anonymous callers each spend their own.

### Fleet Client

A client app distributed as many installed copies (mobile, TV) that share one baked-in credential and one release cycle. Contrast with a single-egress server client: a fleet cannot rotate its credential without a release and field adoption lag, each device has its own network address, and any globally attached shared credential pools the whole fleet onto one Rate-Limit Identity.

## Admin schema operations

### Forward-Only Migration

A database schema change that is reversed by moving the schema forward again, not by editing or deleting migration history that a deployed database may already have observed. Failed-up recovery and successful-up rollback are different paths: failed attempts can be marked rolled back after cleanup, while successful attempts need a new migration to undo them.

### Known Recoverable Migration

A migration failure state the team has classified as safe for automated failed-row recovery after the root cause or partial schema state is understood. The classification applies only to failed migration rows; it does not mean a successfully applied migration can be removed from history.

## Watch experiences

### Experience

A curated, themed watch page — such as Easter or Christmas — that assembles a selection of watch content under an editorial frame. An Experience is authored in admin (hand-curated by the editorial team, or AI-generated) and published to render as its own standalone page on the watch site, reachable by a public slug of its own (distinct from any single Video's slug).

### Homepage Experience

The single Experience designated as the watch home for a given locale, resolved per-locale as one curated Experience rather than by listing every Experience. Designation is not rendering: it is empty on prod admin, and consumer clients' homes render the Home Curation instead — pointing all platforms back at a real Homepage Experience is a possible future consolidation, not the current state.

### Home Curation

The code-defined content set that fills consumer clients' home screens: a featured hero pool plus ordered content sections, declared in source and fetched by Core ID. Curation lives in code, not the CMS — changing the home's rows is a code release, not an admin edit. Each client (web, mobile, TV) carries the same set, so per-app copies must stay in sync.

### Series-Shaped

The classification that routes a record to a series surface instead of the single-video watch screen: a Video whose label is SERIES or COLLECTION, or any record with children. The test is label/children-based — there is no separate series type in the schema — and every entry point (search, home cards, deep links) applies the same rule.

## Home hero UI

### Three-Layer Hero

The mobile layering pattern for a screen whose feed scrolls over a full-bleed video hero: a display-only hero layer behind the feed, the scrolling feed itself, and a touch overlay above the feed that owns every tappable hero control.

Touches go to the topmost layer and are never re-offered downward, so anything interactive placed in the hero layer is unreachable — the hero's Chrome must live in the overlay, which passes gestures it doesn't own through to the feed. When the hero itself needs a gesture (such as swiping between paged slides), a shared ancestor intercepts it before the feed's scroll can claim it, taking only gestures whose direction marks them as the hero's.

### Hero Insert

An editorial slide in the watch-home Hero Queue sourced from media outside the Video catalog, carrying its own stream and overlay copy. Its greeting and daily selection are anchored to one fixed reference clock, so every user worldwide sees the same insert on a given day.
_Avoid:_ Mux insert.

### Hero Queue

The ordered lineup of slides the watch-home hero rotates through, built by drawing candidate videos round-robin from the Carousel Pools and merging Hero Inserts at their configured positions. The lineup is deterministic for a given calendar day — a date-seeded pick, identical for every user — so the rotation changes daily without anyone editing it.

A rebuilt Hero Queue restarts the rotation from its first slide, so clients avoid rebuilding while a user is mid-viewing unless the underlying content actually changed. When every eligible video has already been seen, the queue wraps: it rebuilds ignoring the Played Set, and the set starts a fresh cycle.

### Carousel Pool

One curated group of collections whose videos are candidates for the Hero Queue. Pools are drawn from in a fixed round-robin order, with the day's date-seeded pick choosing which candidate each pool contributes.

### Played Set

The per-user memory of which videos the watch-home rotation has already shown, used to exclude them from Hero Queue rebuilds so returning users lead with unseen content. It resets each calendar month, and a Hero Queue wrap clears it early — but a content outage that merely looks like a wrap must not.

### Home Snapshot

The last successful watch-home content response a client keeps on device and paints immediately at the next launch while a live fetch revalidates in the background. It exists to mask a slow content resolver; it is only ever the first paint.

An expired, shape-drifted, or empty Home Snapshot never paints — launch falls back to the loading state. When the live response matches the painted snapshot, the client keeps the painted view rather than rebuilding the Hero Queue; an empty live response never replaces a painted snapshot.

### Focus-Driven Showcase

The TV home's top-of-screen canvas that reflects whatever card currently holds D-pad focus — artwork, title, and description swap as focus moves through the rails. It defaults to the first featured item on load and retains the last focused card when focus leaves the rows. The inversion of an autoplay hero: the user's focus drives the canvas, and no background video player is mounted.

## Watch player UI

### Chrome

The auto-hiding controls overlay on the watch video player — the play/pause, scrubber, skip, mute, and fullscreen affordances layered over the footage. Distinct from the captions, which are a separate, always-visible layer that does not hide with it — captions instead reposition to stay clear of the Chrome while it is visible and return when it hides.

The Chrome is visible when playback starts, auto-hides after a few idle seconds while playing, stays up while paused or buffering, and toggles on a tap of the video body. It fades rather than cutting, and is unmounted only after the fade-out completes so a fully-hidden Chrome stops intercepting touches. The home hero's controls are also Chrome; they fade with scroll position rather than idle time, but follow the same rule that hidden Chrome must stop intercepting touches.

### Watch Session

The user's current watch state for one Video — which Dub is active, and whether subtitles are on and which track — shared between the video-details screen and the fullscreen player so the language/subtitle pickers and live playback read and write one source of truth.

A Watch Session belongs to the currently-viewed Video: it is published when the details screen resolves its Video and cleared when that screen goes away, and switching the active Dub mid-playback updates the session rather than restarting playback. It is a single shared instance rather than one-per-screen, so when one watch screen is opened from another (e.g. an Up Next episode), the newer screen takes ownership and the earlier screen must re-assert ownership when it regains focus — the focused screen is always the owner, otherwise a returning screen would find the session emptied by the one it spawned. Player features that depend on it (the in-player language/subtitle menu, subtitle rendering) gate on the session matching what is actually playing, so playback started outside a details screen runs without them.

### Watch Preference

The app-wide, persisted audio- and subtitle-language choice that carries across every Video and series — a stored _intent_ (a Language slug plus a cached display name), distinct from the per-Video Watch Session. Because the same preference flows over content with different Dubs and subtitle tracks, it is reconciled against each item's actual tracks at display and apply time rather than shown verbatim: an unsupported choice falls back to a supported track, and content with no matching track reads "Off".

Identity always keys on the Language slug; the cached name paints labels instantly on a cold load but is never used for matching. Toggling subtitles on or off changes visibility only — it never rewrites the stored language, which only an explicit pick changes.

## AI chat

### Seeker Agent

The first conversational agent of the planned headless Jesus Film AI Chat system, for people exploring Christianity and who Jesus is. It grounds factual answers through retrieval rather than answering from model memory: its retrieval tool fetches cited passages and the agent's own LLM synthesizes the answer, attributing sources. Studio-only until the deferred guardrail gate lands.

### JesusFilm RAG

The external `jesusfilm-rag` retrieval service — a standalone system serving biblically aligned content to JFP consumers over a versioned HTTP contract with per-consumer bearer tokens. It is retrieval-only by design ("consumers ask, this service retrieves"): it returns ranked, cited passages, never generated answers, and all audience-specific weighting and generation live in the consumer.
