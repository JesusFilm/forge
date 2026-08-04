# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Devotional generation

### Devotional Workspace

The canonical file and search data plane for devotional generation. It owns
human-authored inputs and generated artifacts while PostgreSQL owns workflow
state and the Shorts Worker performs automated media-byte processing.

A workflow attempt reads the current Devotional Workspace inventory and carries
bounded file references through durable state. The Workspace is live rather
than versioned, so a new retry can consume files edited after an earlier
attempt. A Devotional Catalog Generation snapshots eligible input metadata for
selection; it does not freeze or version the Workspace bytes themselves.

When media execution crosses into Shorts Worker, the Devotional Workspace owner
issues attempt-scoped temporary capabilities. The Worker may transfer the
authorized bytes but never receives durable Workspace credentials or ownership.

### Devotional Catalog Generation

An atomic, committed projection of the Devotional Workspace inputs used to
select eligible sources during Devotional Attempt provisioning.

A generation stores eligible document content and integrity metadata for
search. Attempts carry only bounded Devotional Source References and re-read
Workspace files before use; if a selected file changes, the existing attempt
fails closed and a retry selects from a newly reconciled generation.

### Devotional Attempt

A durable record of one try to generate a devotional, binding request identity
to a Devotional Catalog Generation and its selected Devotional Source
References.

An attempt exists before its workflow run is created so retries, restarts, and
duplicate requests cannot create competing work. A retry creates a new attempt
that may observe newer Workspace inputs; it does not silently rewrite the
sources of an existing attempt.

### Devotional Source Reference

A bounded, content-addressed description of one Devotional Workspace input
selected for a Devotional Attempt, carried through durable workflow state
without embedding the source content itself.

The workflow re-reads each selected file and compares its integrity metadata
before external or irreversible boundaries. A mismatch fails the attempt
rather than generating or publishing from mixed source versions.

## Video & media

### Smart Crop

A Manager-orchestrated media-generation workflow that produces 9:16 vertical
crop plans and renders from widescreen Mux videos. Manager owns durable job
state and operator review, Mastra owns bounded AI crop decisions, and
crop-worker owns FFmpeg fingerprint/render byte work.

### Core ID

The stable identifier from the Core API for a Core-sourced entity. For source
video attribution, a Video's Core ID is the canonical answer to "which video",
while a Dub's Core ID is Core's identifier for that specific language variant.

### Video

A piece of watchable content — a feature film, a segment of one, or a container node (series, collection) in a parent/child tree. A Video is not directly playable on its own: its watchable audio comes from its Dubs and its subtitles from a Video Edition. Videos relate to each other as parents and children, which is how series and their Episodes, films and their Chapters, and "Up Next" siblings are all formed — so a parent/child link alone does not say whether the parent is a container.

### Dub

One audio-language variant of a Video — the unit the watch screen's language picker selects (a popular title can have thousands of Dubs). A Dub carries its own playable stream and its own set of downloadable renditions, and points at the Video Edition whose subtitle tracks apply to it.
_Avoid:_ variant (the mobile client aliases Dubs as "variants").

### Video Edition

A cut/edition of a Video that owns the subtitle tracks. Subtitles hang off the Edition, not off individual Dubs — a Dub references the Edition whose subtitles apply, so many Dubs sharing an edition share one set of subtitle tracks.

### Language

A language a Video is offered in: every Dub is for one Language, and subtitle tracks are per-Language. A Language has two identifiers that are easy to conflate — a unique, stable slug that is its identity (e.g. korean, kurmanji-standard), and a BCP-47 tag that is a locale label (e.g. ko, ko-kmr) and is deliberately not unique per language, so distinct Languages can share a tag or its prefix. Identity comparisons and cross-system transport key on the slug; the BCP-47 tag is for locale negotiation and locale-sensitive search execution.

### Watch Language Inventory

The public language-scoped catalog of indexable Watch Videos, organized into
fully dubbed collections, fully dubbed standalone videos, and videos available
only through subtitles in that Language.

Audio availability takes precedence over subtitle-only membership, while
collection containers and playable leaf Videos remain distinct inventory
groups even when they share the same underlying language coverage.

### Contextual Watch Route

A public Watch URL that identifies a parent collection, child Video, and
Language together so navigation can preserve the child's collection context
when that exact relationship is valid.

### Standalone Watch Route

The canonical public Watch URL for a Video and Language independent of any
collection relationship. Eligible English uses
`/watch/{video-slug}.html`; non-English uses
`/watch/{video-slug}.html/{language-slug}.html`. Explicit
`/english.html` remains a direct compatibility/internal route. If the Video
slug is also a public language-home slug, English stays explicit so the
language home retains the one-segment URL. Contextual Watch Routes keep their
parent, child, and explicit language segments in the browser.

### Watch Route Manifest

An Admin-owned snapshot of public Watch route dimensions used by consumers to
admit or reject possible contextual and standalone routes before resolving page
content.

The manifest is an admission contract, not a rendering payload or historical
record; absence can disprove current route validity but cannot explain why a
relationship changed.

### Watch Search & Social Metadata Overlay

Editor-owned, per-language promotional metadata for a Watch Video that may
change the page title, description, and social-card image without changing the
viewer-visible Video identity, canonical route, or structured media identity.

An absent overlay inherits the selected locale's canonical copy and existing
image fallback. Managed social art remains promotional: it does not become the
Video's thumbnail truth.

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

An algorithm version names the complete extraction and comparison contract.
Signatures from different versions may coexist but are not interchangeable; a
project rule requires introducing a new version for sampling or hashing changes
before readers select it.

### Media Fingerprint

A deterministic, content-derived Media Signature designed to identify source
footage from raw clip bytes, such as visual frame perceptual hashes or audio
landmark hashes at source offsets.

Media Fingerprints are not text embeddings or catalog lookups. They are the
primary proof for arbitrary raw clip matching when uploaded files have no
metadata, subtitles, timing offsets, or audio.

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

### Complete Match Job

A terminal Match Job whose attribution attempt finished, regardless of whether
it produced any Match Candidates.

A Complete Match Job with no candidates still carries the completed status so
polling clients can stop waiting and handle the no-match result explicitly.

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

### Search Serving Index

A rebuildable, query-optimized projection of catalog metadata and Content
Embeddings used by Admin search, distinct from the authoritative content store.

A Search Serving Index may retain a broader semantic corpus than one caller can
return. Each serving surface applies its own explicit visibility policy, while
publication or availability changes update the projection without redefining
the underlying embedding.

### Public Search Visibility

The eligibility of search evidence to contribute to viewer-facing Watch Search,
distinct from whether that evidence belongs to the Search Serving Index.

Public Search Visibility requires the source video to remain viewer-visible and
the evidence language to have matching published content. Losing eligibility
removes the evidence from public results without requiring a valid Content
Embedding to be regenerated.

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

### Watch Search Analytics

Datadog product observability for viewer-facing Watch search. Watch
Search Analytics records anonymous submitted search requests, outcomes,
no-result cases, load-more behavior, and result clicks so the team can
understand common queries, failures, language mismatch signals, search-mode
health, and clicked results.

The canonical submitted-search event is a structured log emitted from each
client's canonical path — web's server-side search path; React Native clients
(TV and mobile) emit it from the device via the Datadog Mobile
SDK because they have no server tier — using asynchronous, non-blocking,
best-effort fire-and-forget delivery so search responses do not wait on
Datadog. RUM can add supplemental UI context and click signals, but RUM
sampling is not the source of truth for submitted-search counts.

Result clicks and impressions are additionally recorded first-party in admin's
watch-search event store (client-tagged `WEB`/`MOBILE`/`TV`), which — unlike
RUM — is unsampled and joins to Search Traces by the anonymous search request
id.

Watch Search Analytics is separate from Search Eval. It may include exact query
text, but its authored payload must not attach name, email, full user id, auth
token, cookie, session id, IP address, or bearer/API key material. RUM envelope
context the Mobile SDK attaches to client-emitted events (session and view ids)
is correlation context outside the authored payload, not an exception to this
rule. On client-emitted events, log severity itself participates in
containment: the Mobile SDK copies error-level logs' full authored attributes
into RUM error events, so query-bearing logs stay below error level to keep
exact query text bounded to the Logs store.

### Watch Analytics Context

An optional anonymous context object future Watch event collection can provide
to product analytics emitters such as Watch Search Analytics. It can carry
sanitized page, video, playback, language, and referrer context into Datadog RUM
events without making Watch event storage or ingest a dependency of search
analytics.

Watch Analytics Context is trusted provider context, not a free-form browser
payload. Until a Watch event provider owns that context, canonical server
analytics should omit it and rely on server-derived dimensions plus the
anonymous search request id.

### Search Language

The language semantic search uses to interpret and match a query. Search Language is separate from UI locale, public Watch route language, and audio-language selection: changing it affects search results but does not change the viewer's website language, URL language segment, or selected Dub.

Search Language identity should travel as the public language slug selected or confirmed by the viewer. Locale tags are useful for fallback negotiation and search execution, but they are not the exact identity of the viewer's chosen search language.

### Search Watchability

The target-language playback state attached to a Watch search candidate, distinguishing playable target audio, target subtitles, related-language audio, and no qualifying playback option. Search Watchability describes what the viewer can play and where the result should link; it refines ordering only after textual match and relevance.

Only the target-audio and related-language states can carry a playable Dub; the target-subtitle and no-option states name what exists (subtitles in the target language, or nothing) without one.

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

### Semantic-Video Retriever

The Admin video semantic retrieval family that contributes one ranked video list
to search fusion. The name is a compatibility label: after enriched transcript
realignment, its runtime evidence comes from transcript chunks rather than scene
embeddings.

### AI Gateway

The project-owned, OpenAI-compatible provider surface fronting self-hosted models. It serves two model families: the embedding model that produces vectors for Content Embeddings, and chat models available as opt-in primaries for conversational agents (the Seeker Agent and the experience-editing agents), each behind its own default-off gate with the free/external provider chain kept as failover. Credentials are model-scoped — a chat key cannot call the embedding model and vice versa. AI Gateway health proves provider availability, not that Admin can launch or store a specific embedding backfill through Mastra.

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

### Enriched Transcript Chunk

A Transcript Chunk whose embedded text includes the transcript excerpt plus
search-oriented metadata such as time range, felt needs, Bible references,
summary, tone, audience cues, and spiritual context.

The enriched input and the structured fields are both stored so search
relevance can be debugged without falling back to legacy scene artifacts.

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

### Video Database Snapshot

A reviewed, profile-scoped, data-only export of production Admin video data for restoring production-like content into non-production environments. Its default form carries catalog and reference data, while its opt-in search form adds current transcript search state plus retained historical scene-search state.

A Video Database Snapshot reuses stored vectors; it does not generate Content Embeddings or perform an Embedding Backfill.

## Known-caller auth

### Known-Caller Check

The request-level question "are you a known caller?" rather than "what may you do?". Any key from any known-caller class satisfies it, and it grants no data permissions — it identifies the caller class, nothing more. Distinct from editor/session auth.
_Avoid:_ Search Passport

Which surfaces apply it as an admission gate is a per-surface decision. Public read surfaces admit anonymous callers regardless, and use a presented key only to select the Rate-Limit Identity — so a missing or unrecognised key on such a surface changes the caller's budget, never their access.

### Consumer Bearer

A known-caller key issued to a consumer-facing app surface (web, mobile, TV) that satisfies the Known-Caller Check while carrying no permissions beyond public access. Each surface holds its own dedicated key so revocation and rotation stay per-surface.

A Consumer Bearer doubles as the request's Rate-Limit Identity: every request presenting the same key spends one shared budget. That is correct for a single-egress server and hazardous for a Fleet Client — on a fleet, the key must ride only on the operations the server actually gates.

### Rate-Limit Identity

The identity a request's rate budget is counted under: an authenticated user's own identity, else the presented Consumer Bearer's key, else the caller's network address. Which identity a request lands on determines whose budget it spends — a shared key pools many callers into one budget, while anonymous callers each spend their own.

### Fleet Client

A client app distributed as many installed copies (mobile, TV) that share one baked-in credential and one release cycle. Contrast with a single-egress server client: a fleet cannot rotate its credential without a release and field adoption lag, each device has its own network address (though carrier-grade NAT can collapse many devices onto one), and any globally attached shared credential pools the whole fleet onto one Rate-Limit Identity.

### Viewer Id

A client-generated, stable-per-device identifier a Fleet Client attaches to a request so the server can count that device's rate budget on its own Rate-Limit Identity rather than a shared credential or a carrier-collapsed network address. It is an availability mechanism, not an authorization or abuse control: being client-supplied it is freely rotatable, so a global per-credential ceiling remains the abuse bound.

## User sign-in

### SSO Session

The sign-in session the auth provider itself holds for a person, shared by all first-party relying apps — signing in to any one app rides it, and it is what lets a later sign-in skip the login page.

It is rolling: active use extends its expiry, so it has no fixed end while a browser keeps using it. An App-Local Session ending (sign-out or expiry) leaves the SSO Session alive; ending it belongs to the provider, not to relying apps.

### App-Local Session

A relying app's own record that a person is signed in to that app, held by the app and independent of the SSO Session — ending it signs the person out of that app only.

Created from a completed OIDC sign-in; each app chooses its own lifetime, which the SSO Session's rolling behavior does not extend.

### Force-Login Marker

A single-use, browser-local flag a relying app sets at sign-out so the next sign-in to that app shows the provider's real login page instead of silently reusing the live SSO Session. Per-app: one app's marker does not affect its siblings' sign-ins.

Armed at sign-out; consumed only by a completed sign-in — an abandoned or failed attempt leaves it armed so the retry still forces a login page. Consuming it any earlier (when a sign-in merely starts) silently disarms the protection — a known implementation pitfall. Its lifetime is sized generously relative to the rolling SSO Session, which single-use consumption makes cost-free. It prevents accidental silent re-auth on a shared browser, not a deliberate user who clears the app's cookies, and it leaves the SSO Session itself untouched.

## Admin schema operations

### Forward-Only Migration

A database schema change that is reversed by moving the schema forward again, not by editing or deleting migration history that a deployed database may already have observed. Failed-up recovery and successful-up rollback are different paths: failed attempts can be marked rolled back after cleanup, while successful attempts need a new migration to undo them.

### Known Recoverable Migration

A migration failure state the team has classified as safe for automated failed-row recovery after the root cause or partial schema state is understood. The classification applies only to failed migration rows; it does not mean a successfully applied migration can be removed from history.

## Watch experiences

### Experience

A curated, themed watch page — such as Easter or Christmas — that assembles a selection of watch content under an editorial frame. An Experience is authored in admin (hand-curated by the editorial team, or AI-generated) and published to render as its own standalone page on the watch site, reachable by a public slug of its own (distinct from any single Video's slug).

### Experience Block

An ordered, schema-validated content unit within an Experience. Blocks carry a discriminator that identifies their content semantics, while presentation variants can change a block's treatment without creating a different content kind; section blocks compose other blocks under a shared visual shell.

### Media Collection Block

An Experience Block that groups ordered watch content beneath independently authored category, title, supporting-title, description, call-to-action, and footer semantics; its presentation variant may change the media layout but not the authored content hierarchy.

### Homepage Experience

The single Experience designated as the watch home for a given locale, resolved per-locale as one curated Experience rather than by listing every Experience. Designation is not rendering: web, mobile, and (as of 2026-07) TV all now render this Experience's rows as their home body, each hydrating a curated item by the item's Core ID through the client's bulk video fetch — supplemented by an on-demand fetch for curated items the client's code-defined pool does not already cover, since an editor can reference content outside that pool. A supplementary hydration record feeds only the Experience rows, never the code-defined featured hero. The featured hero stays code-defined per client — see Home Curation.

### Home Curation

The code-defined content set that fills consumer clients' home screens: a featured hero pool plus ordered content sections, declared in source and fetched by Core ID. Web, mobile, and TV now all source their rows from the Homepage Experience and keep the featured hero pool in code; the code row sections survive only as a frozen fallback rendered when the Experience is unavailable. The featured hero pool stays code-defined — its live half mirrored across clients — while the row sections are no longer mirrored where the Experience is the source.

### Cinematic

A Video's own wide key artwork, framed for a landscape card or hero. It is the fallback every home and search surface falls back to when no editorially curated art is attached, and it is the only artwork the catalog holds for a Video — there is no portrait cut of it.

### Curated Poster

Portrait artwork an editor attaches to a single item of an Experience row, overriding whatever the linked Video's own Cinematic would have supplied. Because the catalog has no portrait art of its own, a Curated Poster is the only way a home row can show tall artwork.

### Poster Rail

A home row whose every item carries a usable Curated Poster, letting it render tall poster cards instead of the wide Cinematic cards used elsewhere.

Coverage is all-or-nothing: a single item without usable poster art demotes the whole row back to Cinematic cards, because a tall frame filled with wide artwork crops it to a sliver. The check that grants a row its poster shape is the same one that selects its cards' artwork, so a Poster Rail's cards always show the curated art and the two can never disagree. Poster status is distinct from a row's declared layout orientation, which mirrors a sibling client's grid arrangement and implies nothing about artwork — a row can be laid out vertically and still have no poster to show. The guarantee reaches only as far as _authored_ art: nothing verifies a Curated Poster is actually portrait, so a row of wrongly-shaped uploads still claims the tall frame.

### Showcase Mode

The TV app's public ambient mode: a self-running reel of short catalog excerpts organized as felt-need chapters with periodic stat interstitials, started from Home's Settings tab. Built to run unattended on office TVs for visiting stakeholders but shipped as a consumer feature, so any remote press exits and auto-start is opt-in. Excerpts shipped with per-excerpt language rotation; the 2026-07-17 contract amendment replaces that with viewer-language playback plus a Language Centerpiece.

### Showcase Experience

The CMS-authored Experience that defines Showcase Mode's reel, fetched by slug through the public Experience query (no admin code involved): its sections name the felt-need chapters and order each chapter's videos. When it is missing or empty, TV composes a fallback reel from the Home pool instead. One section is reserved: a section titled `showcase-stats` supplies the stat interstitials' authored lines and never renders as a chapter.

### Excerpt

A bounded window of a catalog video that Showcase Mode plays in place of the whole title — the reel's unit of playback, not a separate asset. The reel advances at the window's end, not only at the video's, so an excerpt's end is usually a decision the reel makes about a still-playing source. An excerpt that reports itself unplayable is skipped; enough consecutive skips drop the reel to Stills.

### Chapter Card

The titled card Showcase Mode shows when entering a felt-need chapter, naming the need the chapter answers. It doubles as the buffer window: the player is held paused but loaded behind it, so the next excerpt is fetching while the card is on screen. A card that lifts before its excerpt has loaded therefore exposes the gap it exists to cover.

The card dissolves in only when live video is beneath it; entered from any covered or empty state it appears already opaque, and once shown it never returns to transparency while up. Its exits dissolve out to the next excerpt's cover — except under reduced motion, where every seam cuts instead of fading.

### Covered Swap

A reel source change performed while a full-screen overlay — a chapter card or stat interstitial — covers the player. Everything beneath the overlay holds still until the overlay is fully opaque, then changes silently under it, so a dissolving overlay never reveals a layer mid-change. Its counterpart, the visible seam between two excerpts, masks the swap with the poster dissolving over the outgoing frame instead.

### Language Centerpiece

The language chapter's extended excerpt in Showcase Mode's curated reel: one dub-rich video that switches audio dubs mid-play — always opening in English, then hopping to randomly-ordered unique dubs at the pauses following completed sentences in the video's English subtitle track (every segment plays at least ten seconds and never cuts mid-sentence), naming each on screen — so the catalog's language breadth lands as one continuous scene instead of ambient rotation. A centerpiece whose English track has no usable subtitles degrades to the earlier fixed ~10-second cadence for that video. Exactly one chapter carries the machine-readable marker that triggers it, and it is the reel's only excerpt allowed past the standard window ceiling; a reel authored without the marker plays with no dub-switching anywhere.

### Hop Handoff

The seamless boundary between two dubs in the Language Centerpiece: a second, invisible standby player preloads the next dub to just past the upcoming boundary while the current dub plays, so the boundary is a role flip plus a brief crossfade rather than a source swap on the visible player.

The crossfade waits until the incoming dub is confirmed in motion — until then the outgoing player keeps rolling as the Motion Cover. A preload that is not ready in time degrades that one boundary to the ordinary poster-masked seam, and a handoff whose incoming dub never confirms is abandoned at the next boundary. The pattern deliberately supersedes the reel's original single-player rule: the platform leak that rule guarded against is triggered by player churn, not by a second permanently-bound player.

### Motion Cover

The outgoing dub's player left rolling silently past its window end during a Hop Handoff, so the screen shows continuous motion of the same footage while the incoming dub spins up.

Its audio has already faded to silence by the window end; only the picture rolls on. The cover is retired shortly after the incoming dub's reveal, parked when the app backgrounds mid-handoff, and abandoned by the boundary that skips a dead handoff — it never outlives the seam it exists to cover.

### Stills

Showcase Mode's degradation floor: a slideshow of poster art from the last-good reel, entered when consecutive excerpt failures cross the breaker or when nothing playable resolves at all. It is a holding state rather than an end state — it periodically re-attempts resolution and rejoins the reel when one succeeds, which is what keeps a network blip from ending the session.

### Chapter

A child Video that is a segment of one longer film, not a work in its own right. Chapters are how a feature film is broken up for navigation; the parent film remains a single playable item, and the Chapters are an index into it rather than a season of separate works.
_Contrast:_ an Episode is a child of a series and stands alone. Because both arrive as parent/child links, the child relationship cannot distinguish them — only the parent's catalog label does.

### Episode

A child Video of a series that is a work in its own right — watchable and meaningful on its own, one installment of an ordered run. Only a Series-Shaped parent has Episodes; a film's children are Chapters.

### Series-Shaped

The classification that routes a record to a series surface instead of the single-video watch screen: a Video whose label is SERIES or COLLECTION. The test is label-only — there is no separate series type in the schema — and every entry point (search, home cards, deep links) applies the same rule.

Children are deliberately **not** part of the test. A feature film may carry its own Chapters as children while remaining one playable item, so presence of children says nothing about whether a record is a container. Both directions of the watch/series redirect read this one classification, which is what keeps them exact inverses.

### First Rail Ready

The moment the series detail screen first shows a populated episode rail — the canonical series-load performance signal, recorded once per screen visit as the `series_first_rail_ready` view timing.

Fires only on real content readiness: a partially-cached series that paints its hero before episodes arrive has not reached First Rail Ready, and returning to an already-loaded series never re-fires it — a near-zero re-measure would poison the metric's percentiles.

## Home hero UI

### Three-Layer Hero

The mobile layering pattern for a screen whose feed scrolls over a full-bleed video hero: a display-only hero layer behind the feed, the scrolling feed itself, and a touch overlay above the feed that owns every tappable hero control.

Touches go to the topmost layer and are never re-offered downward, so anything interactive placed in the hero layer is unreachable — the hero's Chrome must live in the overlay, which passes gestures it doesn't own through to the feed. When the hero itself needs a gesture (such as swiping between paged slides), a shared ancestor intercepts it before the feed's scroll can claim it, taking only gestures whose direction marks them as the hero's.

### Hero Insert

An editorial slide in the watch-home Hero Queue sourced from media outside the Video catalog, carrying its own stream and overlay copy. Its greeting and daily selection are anchored to one fixed reference clock, so every user worldwide sees the same insert on a given day.
_Avoid:_ Mux insert.

### Hero Queue

The ordered lineup of slides the watch-home hero rotates through, built by drawing candidate videos round-robin from the Carousel Pools and merging Hero Inserts at their configured positions. The lineup is deterministic for a given calendar day — a date-seeded pick, identical for every user — so the rotation changes daily without anyone editing it.

A rebuilt Hero Queue restarts the rotation from its first slide, so clients avoid rebuilding while a user is mid-viewing unless the underlying content actually changed. The queue holds a fixed size as content is consumed: unseen videos lead, and when they cannot fill the target, already-played videos return behind them rather than the carousel shrinking. When every eligible video has already been seen, the queue wraps: it rebuilds ignoring the Played Set, and the set starts a fresh cycle.

### Carousel Pool

One curated group of collections whose videos are candidates for the Hero Queue. Pools are drawn from in a fixed round-robin order, with the day's date-seeded pick choosing which candidate each pool contributes.

### Hero Eligibility

The rule deciding which catalog records may appear as Hero Queue slides: individually-playable videos — feature films and short films — are eligible and contribute their own tile, while container records (collections and series) are excluded, even though Carousel Pools are built around such containers.

An eligible film is emitted as a single parent tile, never expanded into its Chapters — a feature film with many of them still shows as one hero slide. Clients enforce the same rule through different signals: the web client keys on whether a record carries a playable stream, while the leaner native clients, which do not fetch that stream, approximate it from the record's catalog type. That approximation is deliberately looser than exact stream-level playability, so a native client may surface a few films the stream-level check would drop. Because Carousel Pools that yield no eligible video drop out entirely, excluding the containers can also change which later pools the round-robin reaches.

### Played Set

The per-user memory of which videos the watch-home rotation has already shown, used so Hero Queue rebuilds lead with unseen content — played videos are deprioritized behind unseen ones rather than excluded outright. It resets each calendar month, and a Hero Queue wrap clears it early — but a content outage that merely looks like a wrap must not.

A video enters the set when the rotation departs its slide, regardless of why it departed — watched to the end, navigated away, or skipped by a playback failure — so a persistently failing slide is recorded as "seen" just like a watched one and yields its priority until the set resets.

### Home Snapshot

The last successful watch-home content response a client keeps on device and paints immediately at the next launch while a live fetch revalidates in the background. It exists to mask a slow content resolver; it is only ever the first paint.

An expired, shape-drifted, or empty Home Snapshot never paints — launch falls back to the loading state. When the live response matches the painted snapshot, the client keeps the painted view rather than rebuilding the Hero Queue; an empty live response never replaces a painted snapshot.

### Focus-Driven Showcase

The TV home's top-of-screen canvas that reflects whatever card currently holds D-pad focus — artwork, title, and description swap as focus moves through the rails. It defaults to the first featured item on load and retains the last focused card when focus leaves the rows. The inversion of an autoplay hero: the user's focus drives the canvas, and no background video player is mounted.

## Watch player UI

### Watch Modal Activity

The aggregate ownership state of every Watch overlay that must suspend route-owned playback, independent of which component renders the overlay or which player is active.

Activity begins when the first owner opens and ends only after the final owner releases through its visible close lifecycle. Resume entitlement belongs to the exact media and source that were playing before activity began; late, replaced, or source-swapped media is paused without inheriting that entitlement.

### Chrome

The auto-hiding controls overlay on the watch video player — the play/pause, scrubber, skip, mute, and fullscreen affordances layered over the footage. Distinct from the captions, which are a separate, always-visible layer that does not hide with it — captions instead reposition to stay clear of the Chrome while it is visible and return when it hides.

The Chrome is visible when playback starts, auto-hides after a few idle seconds while playing, stays up while paused or buffering, and toggles on a tap of the video body. It fades rather than cutting, and is unmounted only after the fade-out completes so a fully-hidden Chrome stops intercepting touches. The home hero's controls are also Chrome; they fade with scroll position rather than idle time, but follow the same rule that hidden Chrome must stop intercepting touches.

### Watch Session

The user's current watch state for one Video — which Dub is active, and whether subtitles are on and which track — shared between the video-details screen and the fullscreen player so the language/subtitle pickers and live playback read and write one source of truth.

A Watch Session belongs to the currently-viewed Video: it is published when the details screen resolves its Video and cleared when that screen goes away, and switching the active Dub mid-playback updates the session rather than restarting playback. It is a single shared instance rather than one-per-screen, so when one watch screen is opened from another (e.g. an Up Next episode), the newer screen takes ownership and the earlier screen must re-assert ownership when it regains focus — the focused screen is always the owner, otherwise a returning screen would find the session emptied by the one it spawned. Player features that depend on it (the in-player language/subtitle menu, subtitle rendering) gate on the session matching what is actually playing, so playback started outside a details screen runs without them.

### Watch Preference

The app-wide, persisted audio- and subtitle-language choice that carries across every Video and series — a stored _intent_ (a Language slug plus a cached display name), distinct from the per-Video Watch Session. Because the same preference flows over content with different Dubs and subtitle tracks, it is reconciled against each item's actual tracks at display and apply time rather than shown verbatim: an unsupported choice falls back to a supported track, and content with no matching track reads "Off".

Identity always keys on the Language slug; the cached name paints labels instantly on a cold load but is never used for matching. Toggling subtitles on or off changes visibility only — it never rewrites the stored language, which only an explicit pick changes.

## Offline downloads

### Download Record

The persisted per-Video manifest entry that owns an offline copy's lifecycle — one record per Video, moving through queued, downloading, paused, downloaded, failed, or canceled. A record stores stable identity (which Dub and rendition) rather than volatile signed URLs, so every start and restart re-resolves a fresh URL from identity; the record is the single source the library rows, series badges, and batch aggregates all derive from.

### Batch Placeholder

A bare queued Download Record — no partial or committed file yet — persisted up front for every episode when a series batch begins, so waiting episodes show a badge and are covered by Cancel All before their transfer exists. Bare-queued is the batch's ownership signature: the start path adopts its own placeholder and drives it forward, where any other live record would be refused as already existing.

### Batch Pump

The named process that drains a series batch strictly in episode order: one native download at a time, the next starting only when the previous reaches a terminal state. The pump's queue lives in memory while placeholders persist, so an app relaunch re-seeds surviving placeholders into a fresh queue rather than restarting them in parallel. A paused batch episode deliberately keeps its slot — Pause All halts the whole batch — while paused downloads outside the batch never block it.

### Swap

The non-destructive replacement of a downloaded copy with a different quality or language: the new copy downloads alongside the old, which stays playable until the new one commits, and canceling mid-swap reverts to the old copy rather than deleting it.

Because a revert lands the episode back in the downloaded state, a canceled or failed swap is indistinguishable at the record level from a genuine completion — anything that must know which transition occurred (a completion toast, a progress-ring reset) has to carry that signal explicitly rather than infer it from aggregate terminal state.

### Supersede

Stopping an in-flight download's native task and neutralizing its callbacks — without touching its record — so a replacement download can safely reuse the same Video's task identity. Needed because the native downloader routes terminal events by task id to whichever task currently holds it, so an un-superseded old task's dying event could strike its replacement.

## AI chat

### Seeker Agent

The first conversational agent of the planned headless Jesus Film AI Chat system, for people exploring Christianity and who Jesus is. It grounds factual answers through retrieval rather than answering from model memory: its retrieval tool fetches cited passages and the agent's own LLM synthesizes the answer, attributing sources. Studio-only in production until the seeker dogfood gate (feat-233) opens access to individually-targeted internal staff; the deferred guardrail gate remains the precondition for wider audiences.

### Seeker Dogfood Gate

The layered per-request decision in the chat app that resolves seeker-vs-stub: the coarse service-wide kill switch, then a verified signed-in identity, then membership in an operator-maintained allowlist of dogfooder emails held in the chat service's configuration. Default-deny and fail-closed by construction — anonymous users, unlisted users, identities without a verified email, and an unset or empty allowlist all resolve to the stub; delisting a user is a configuration change that takes effect when the service restarts with the new value. Distinct from authorization proper: it gates a single feature for named people and deliberately skips session revocation and a membership gate.

### Conversation History

The server-side read surface over persisted Seeker threads: a signed-in user lists their own conversations and replays or resumes any of them, with new sends appending to the same thread. Signed-in-only by design — anonymous conversations persist for the session but are never listable or replayable, so they stay effectively ephemeral (a privacy feature: the anonymous continuity cookie must never become a history-reading credential). During the dogfood phase the surface additionally rides the Seeker Dogfood Gate.

### JesusFilm RAG

The external `jesusfilm-rag` retrieval service — a standalone system serving biblically aligned content to JFP consumers over a versioned HTTP contract with per-consumer bearer tokens. It is retrieval-only by design ("consumers ask, this service retrieves"): it returns ranked, cited passages, never generated answers, and all audience-specific weighting and generation live in the consumer.

### Managed Prompt

A system prompt whose tunable text lives in Langfuse — versioned, label-addressed, access-controlled — rather than in this public repo, retrieved at runtime by the Mastra helper `getManagedPrompt`. Retrieval is label-following (explicit label, else an env-configured default, else `production` — never implicit latest), cached with a TTL and failure cooldown, and always resolved against a caller-supplied fallback: every failure mode serves the compiled-in fallback with provenance saying which was served, so prompt retrieval can never break boot or a chat turn. Retrieval-only by design — authoring, versioning, and label moves stay in the Langfuse UI. Every agent's prompt lives in one Langfuse project, with labels marking which version each environment runs, so promoting a tuned prompt is a label move rather than a copy between projects. The seeker agent is the first consumer (feat-272): its whole system prompt — safety and citation wording included, no composition split — is the managed prompt `seeker-system`, with the full working text compiled in as the fallback. Confidentiality of the tuned text extends only to the Mastra network boundary: the runtime's built-in `/api/agents*` surface returns resolved instructions verbatim, so the managed prompt is kept out of the public repo but must never carry secrets.

During failure windows the last successfully fetched prompt keeps serving (serve-stale) in preference to the fallback — so deleting a prompt or revoking a key does not retract text already cached in a running process. Retraction is a label move (effective within one cache TTL, and only while the prompt still exists and the credential is trusted) or a restart with the configuration removed — the only path that works after a deletion, a revocation, or against a hostile key; the fallback serves only when no managed text was ever cached.

## Flagged ambiguities

- "Showcase" names two unrelated TV surfaces that are close to opposites, and neither is a variant of the other: **Showcase Mode** is the unattended autoplaying reel, while the **Focus-Driven Showcase** is Home's canvas that follows D-pad focus and deliberately mounts no video player. Always qualify which one is meant.
- "Search Passport" had named a known-caller check as though it were specific to search, and as though it gated access there. Both are wrong: the check is a general known-caller concept, and the public search surface admits anonymous callers — a key there selects Rate-Limit Identity only. Use **Known-Caller Check**, and say explicitly whether a given surface gates on it.
- "Chapter" carries two unrelated meanings. A **Chapter** is a segment of one feature film (a catalog relationship); a **felt-need chapter** is a themed section of Showcase Mode's reel, announced by a Chapter Card. Qualify which is meant whenever both surfaces are in scope.
- "Episode" had been used loosely for any child Video, which is what let a film's Chapters be counted and billed as episodes. An Episode is a child of a series and stands alone; a film's children are Chapters.
