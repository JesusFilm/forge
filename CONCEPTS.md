# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Application access

### Registered Application

A Jesus Film product or service recognized by Auth as an application-access boundary, with its own ownership, trust posture, lifecycle, deployment environments, grants, and issued tokens.

### Application Environment

A deployment-specific authorization boundary within a Registered Application that carries the OAuth client posture and approval state against which grants and tokens are evaluated.

### Application Grant

An explicit, revocable approval that gives a user or service a set of scopes for one Registered Application and Application Environment; an OAuth client's allowed scopes do not constitute an Application Grant.

### Dynamic MCP Client

A public OAuth client created at runtime by an MCP host so that each host can establish its own callback metadata and client identity without a pre-seeded credential.

Registering a Dynamic MCP Client identifies the client but grants no application access; authorization still depends on an applicable Application Grant, and the companion MCP resource implementation independently enforces the issued token.

## Relationships

A Registered Application contains Application Environments. Application Grants and issued tokens target an Application Environment, while a Dynamic MCP Client requests access to the protected resource associated with that environment.

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

Although registered as the Mastra runtime's single global workspace, it is
deliberately inert toward conversational agents: inherited file tools are
disabled and its storage self-description is suppressed, so no agent's prompt or
tool set ever advertises the Workspace. Devotional business logic reaches it
only through typed devotional repository code — digest-verified reads and
audited writes — never through agent tools.

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

A parent/child link may carry a canonical playback position. The position
belongs to the relationship, not to the child Video, and remains the ordering
authority when a viewer can see only a filtered subset. A link without a
position is unsequenced.

### Dub

One audio-language variant of a Video — the unit the watch screen's language picker selects (a popular title can have thousands of Dubs). A Dub carries its own playable stream and its own set of downloadable renditions, and points at the Video Edition whose subtitle tracks apply to it.
_Avoid:_ variant (the mobile client aliases Dubs as "variants").

### Video Edition

A cut/edition of a Video that owns the subtitle tracks. Subtitles hang off the Edition, not off individual Dubs — a Dub references the Edition whose subtitles apply, so many Dubs sharing an edition share one set of subtitle tracks.

### Language

A language a Video is offered in: every Dub is for one Language, and subtitle tracks are per-Language. A Language has two identifiers that are easy to conflate — a unique, stable slug that is its identity (e.g. korean, kurmanji-standard), and a BCP-47 tag that is a locale label (e.g. ko, ko-kmr) and is deliberately not unique per language, so distinct Languages can share a tag or its prefix. Identity comparisons and cross-system transport key on the slug; the BCP-47 tag is for locale negotiation and locale-sensitive search execution. The slug is unique when it is present, but it is not guaranteed to exist — a Language can carry no slug at all. A consumer must treat a missing slug as an unusable identity and drop that option, never substitute an empty string, because downstream code reads an empty string as "nothing selected".

### Watch Language Search Alias

A reviewed user-entered synonym bound to one or more exact Language slugs for discovery inside a Watch language picker. It filters only options the picker already owns; it never creates language availability or infers identity from a BCP-47 tag.

### Watch Language Inventory

The public language-scoped catalog of indexable Watch Videos, organized into
fully dubbed collections, fully dubbed standalone videos, and videos available
only through subtitles in that Language.

Audio availability takes precedence over subtitle-only membership, while
collection containers and playable leaf Videos remain distinct inventory
groups even when they share the same underlying language coverage.

A subtitle-only entry is actionable only when its requested VTT and fallback
Dub share a compatible Video Edition. Its public path names the playable audio
language, while the requested subtitle language travels as separate one-shot
intent.

## Watch localization

### Watch UI Catalog

The locale-specific tree of interface copy used by Watch surfaces, distinct
from the Languages in which media is available. Every supported UI locale
shares the same message structure even when a narrowly declared leaf still
uses source-language fallback copy.

### Pending Translation Path

A specific Watch UI Catalog message whose source-language copy is intentionally
available in non-source locales while its translation remains unfinished. It
is excluded from translated-source provenance and source-copy completion checks
without making the rest of the catalog provisional.

### Translation Provenance

The generated evidence tying each translated Watch UI Catalog to the source
content, translated content, and translation model that produced it. It covers
the translated portion of a catalog, so Pending Translation Paths do not claim
completed-translation provenance.

### Contextual Watch Route

A public Watch URL that identifies a parent collection, child Video, and
Language together so navigation can preserve the child's collection context
when that exact relationship is valid. An eligible English episode uses
`/watch/{parent-slug}.html/{episode-slug}.html`; non-English episodes use
`/watch/{parent-slug}.html/{episode-slug}/{language-slug}.html`. Explicit
`/english.html` remains a direct compatibility/internal route. Episode slugs
that collide with a current or legacy public language slug also keep explicit
English so the second segment retains language-route precedence.

A Contextual Watch Route owns playback and collection-navigation context, not
search, social, or sharing identity. Its corresponding Standalone Watch Route
owns canonical, Open Graph, structured-data URL, Share, and sitemap identity:
eligible English resolves to the language-less standalone route, while every
other Language resolves to that Language's explicit standalone route. Prominent
discovery surfaces such as Watch homepage and search thumbnails link to the
Standalone Watch Route; contextual links are reserved for navigation inside an
opened collection.

For Watch composition, the parent named by a Contextual Watch Route is the
terminal carousel and next-item context. If that parent cannot form a useful
sibling rail, the page does not substitute the playable child's intrinsic
hierarchy or a different collection.

### Standalone Watch Route

The canonical public Watch URL for a Video and Language independent of any
collection relationship. Eligible English uses
`/watch/{video-slug}.html`; non-English uses
`/watch/{video-slug}.html/{language-slug}.html`. Explicit
`/english.html` remains a direct compatibility/internal route. If the Video
slug is also a public language-home slug, English stays explicit so the
language home retains the one-segment URL.

When a standalone playable Video owns enough exactly admitted children to form
a useful rail, those children are its primary carousel context. Eligible
external collections are a fallback only when that intrinsic rail does not
qualify; they do not become the standalone Video's canonical or next-item
identity.

### Containing Work

A parent Video that the child is a constituent part of — a film whose Chapters
it is one of, or a series whose Episodes it is one of — as distinct from a
curated collection the child was merely gathered into alongside unrelated
material. The distinction is carried by the parent's own label, not by the
parent/child link, which is why a link alone cannot settle it.

Where a Video has several eligible parents and only one may be presented, a
Containing Work outranks a curated collection: it is the work the viewer is
already inside. The relationship's playback position does not decide this — it
orders a child within one parent and says nothing about how two parents compare.
When several Containing Works are eligible, the relationship carries no signal
that separates them.

### Watch Route Manifest

An Admin-owned snapshot of public Watch route dimensions used by consumers to
admit or reject possible contextual and standalone routes before resolving page
content.

The manifest is an admission contract, not a rendering payload or historical
record; absence can disprove current route validity but cannot explain why a
relationship changed.

When a consumer synthesizes a selectable context from parent/child relations,
exact admission means the manifest proves the parent/child pair and that
specific child's selected audio language. A global language entry or fallback
playback stream is not proof that the contextual route exists.

### Watch Search & Social Metadata Overlay

Editor-owned, per-language promotional metadata for a Watch Video that may
change the page title, description, and social-card image without changing the
viewer-visible Video identity, canonical route, or structured media identity.

An absent overlay inherits the selected locale's canonical copy and existing
image fallback. Managed social art remains promotional: it does not become the
Video's thumbnail truth.

### Watch Search Candidate Generation

An immutable set of candidate-owned search projections, with qualification
evidence bound to it, built for private evaluation before it can become the
public Watch search implementation.

A Candidate Generation is recorded before its external collections are built,
then moves through a guarded lifecycle. Failed or retired generations retain
enough ownership evidence for safe cleanup without changing their identity.

### Watch Search Candidate Application Revision

The physical compatibility identity that binds a Watch Search Candidate
Generation to the schema, projection, and retrieval-field contract able to use
its collections.

It remains stable across unrelated application deployments. Ordinary deploy
identity and application-side ranking behavior are not Candidate collection
compatibility.

A change is retroactive, not forward-looking: it reclassifies every generation
already built under the previous revision as incompatible, including one the
Serving pointer currently names. Resolution then fails closed by refusing to
serve rather than falling back to another search implementation, so changing
this revision while a generation is serving public traffic removes that traffic's
only backend. Treat a revision change as a change to the Serving pointer and
sequence it the same way.

### Watch Search Candidate Ranking Revision

The application-side ranking identity included in Candidate qualification
evidence. It changes when Candidate ordering behavior changes, invalidating old
qualification without rebuilding compatible Typesense collections.

### Watch Search Candidate Qualification

An immutable authorization record binding one Watch Search Candidate Generation
and its serving revisions to the evidence reviewed for production use.

An automatic Pass means the release gates succeeded. Operator Accepted means a
reviewer knowingly accepted recorded failed or unrun gates; it authorizes the
measured exception without relabeling those gates as successful. Promotion to
the Serving pointer must match the qualification's exact identity and audit
evidence. Runtime resolution then revalidates an authorizing status and the
serving identity.

### Watch Search Candidate Pointer

A versioned control-plane reference that selects one Watch Search Candidate
Generation for either private evaluation or public serving.

The Evaluation pointer can move without changing public Watch traffic. The
Serving pointer is separate, so publishing a test candidate never promotes it
implicitly.

### Watch Search Retrieval Source

A diagnostic label identifying which retrieval lane recalled a canonical Watch search result before ranking and playback-member selection. One result can have several retrieval sources; the labels explain candidate recall and do not themselves determine the winning rank.

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

### SEO Evidence Observation

A bounded, timestamped record from one measurement surface used by the SEO
Marketing Agent. Google Search Console observations describe Google Search
performance; GA4 observations describe on-site behavior; Firecrawl and direct
page checks describe fetched page state; grounded LLM responses describe only
what that provider returned for a versioned prompt. These evidence classes are
never collapsed into a single source of truth, and a missing row is not a zero.

### SEO Proposal

An immutable, versioned recommendation produced from SEO Evidence Observations
for one canonical page and locale. Editorial proposals carry an exact
field-level draft diff; engineering proposals carry an exact ticket brief.
Approval authorizes only that bounded materialization and never publication.

### SEO Experiment Ledger

The Admin-owned durable history that connects an SEO Proposal to its evidence,
human decision, draft or engineering ticket, verified production activation,
matched measurement windows, confounders, outcome, rollback proposal, and any
reviewed lesson. Mastra orchestrates the work, but the ledger remains the
authoritative record rather than agent conversation memory.

Its execution claims are reclaimable leases: expiry permits another worker to
take ownership, while generation and token fencing determine who may complete.
Experiments become measuring only after objective activation, overlap becomes a
confounder only when treatments are simultaneously live, and canonical drift
forces an inconclusive outcome rather than a lesson or rollback.

### SEO Run Audit Report

The bounded, versioned explanation of one SEO Marketing Agent job: which safe
provider scope reached evaluation, how candidates moved through the decision
funnel, which actions were selected or rejected, and which proposal identities
resulted.

Unlike the SEO Experiment Ledger, the report freezes the machine decision at
job completion and carries only short-lived provider/query detail. Later human
decisions and experiment outcomes remain canonical in the ledger and are
composed with the report when an operator reads it.

### Search Pipeline Mode

A request-side selector that chooses which retrieval pipeline Admin search should run for a caller. A Search Pipeline Mode changes how candidates are gathered and fused; it is not a health signal.

Public compatibility and product serving policy are distinct. A generic caller
may retain a stable omitted-mode default while Admin applies a surface-specific
mode at a request-time orchestration boundary. Operational rollback belongs at
that dynamic boundary rather than in cached client state.

### Shadow Search

A best-effort execution of a non-serving Search Pipeline Mode for the same
submitted query, used to retain comparison evidence while another mode owns the
viewer response.

Shadow Search is bounded background work: saturation, failure, or a slow shadow
must not change the primary result list or extend viewer-visible latency. Its
results belong to evaluation and operational comparison rather than click or
impression attribution.

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

### Search Candidate Generation

An immutable, lifecycle-managed set of Search Serving Index projections built
for private evaluation and possible later promotion without replacing the
current serving indexes.

A generation owns only the projections created for it and may share an
explicitly versioned projection such as the transcript corpus. Evaluation,
serving, and retirement authority remain separate so publishing a generation
does not itself make it public.

### Search Evaluation Pointer

The server-owned reference that selects one ready Search Candidate Generation
for private comparison and qualification without changing public search.

### Search Serving Pointer

The server-owned authorization that permits one qualified Search Candidate
Generation to serve when the deployment selector independently names the same
generation.

The pointer is necessary but not sufficient for promotion: the candidate must
still match its reviewed Search Candidate Identity and current baseline.

### Search Qualification Lease

A bounded, renewable claim that freezes one candidate and current-baseline
identity while comparison or qualification work is active.

Publication fails closed while a lease is active, and lease admission or
renewal fails closed while publication owns the shared mutation boundary.

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

### Absolute Search Gate

The release qualification for a Search Serving Index candidate based on
whether its results satisfy public-search intent, independent of resemblance to
the established Search Pipeline Mode.

An Absolute Search Gate binds a frozen query set and reviewed canonical
relevance judgments to one Search Candidate Identity. Deterministic relevance,
language, duplication, degradation, latency, and capacity evidence must agree
with pointwise judgment and named operator review before the candidate can
become a baseline.

Its pointwise measures are computed over successfully judged cases only, so a
run in which some cases fail reports rates over a subsample rather than over the
query set. Coverage — cases judged against cases attempted — is therefore part
of reading the gate's evidence, and two runs' rates are comparable only at equal
coverage. A failed case lowers coverage without lowering the rate, so a more
degraded run can report a better score than a clean one.

### Search Candidate Identity

The immutable identity under which one search release candidate was evaluated:
its Search Candidate Generation, Admin application revision, transcript
projection, reviewed relevance-set revision, and exact current baseline
bindings.

Release evidence fails closed when this identity is absent or when responses
do not match it, so a deploy, relevance-set update, or index publication cannot
silently reuse qualification from another candidate or baseline.

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

### Search Trace

An Admin-owned first-party record of one search request's resolved language,
retrieval-lane outcomes, result summary, latency, and anonymous request identity,
used for operational analysis and evaluation correlation.

Search Trace persistence is best-effort observability, not part of search
success. Accepted writes run after the response under bounded backpressure, so
a slow analytics store cannot multiply database work or delay the public search
contract; rejected or failed writes remain visible through health signals.

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

### Video Playback QoE

The per-playback-session quality measurements a native client accumulates and
reports once the session ends: time to first frame, rebuffer count, error
count, and watched duration. It describes how well a single viewing went, and
is deliberately narrower than it sounds — several things a naive reading would
count are excluded by definition.

Time to first frame is measured from the player's own mount, never from the
surrounding screen's appearance, so navigation latency is not folded into it. A
rebuffer is a stall that interrupts playback already in progress: the initial
load, a viewer-initiated seek, and a Dub or source swap are all excluded, since
none of them represents a viewer waiting on a stream that was already running.
A session identifies its content by playback id rather than title, because the
payload is constrained to non-sensitive, low-cardinality values.

### Search Language

The language semantic search uses to interpret and match a query. Search Language is separate from UI locale, public Watch route language, and audio-language selection: changing it affects search results but does not change the viewer's website language, URL language segment, or selected Dub.

Search Language identity should travel as the public language slug selected or confirmed by the viewer. Locale tags are useful for fallback negotiation and search execution, but they are not the exact identity of the viewer's chosen search language.

### Watch Search Evidence Language

The Language of the indexed title, metadata, or transcript text that supplied a
Watch search result's winning relevance evidence. It records why the result
matched; it is not automatically the Search Language, UI display language, or
playback identity, and evidence text may become visible card copy only when its
language is appropriate for that result's display or target context.

### Search Watchability

The target-language playback state attached to a Watch search candidate, distinguishing playable target audio, target subtitles, related-language audio, browsable container, and no qualifying playback option. Search Watchability describes what the viewer can play and where the result should link; it refines ordering only after textual match and relevance.

Target-audio and related-language states carry a playable Dub directly. A target-subtitle state keeps the requested subtitle language as availability truth while carrying a deterministic playable Dub action on the compatible Video Edition; the public route uses that action language and passes the subtitle language as explicit intent. A no-option state carries no playable action, so its Search Language remains request context and must not be promoted into a playback identity.

A container state belongs to a Series-Shaped record that owns no Dub of its own but has a playable descendant. It is derived rather than direct: the language it carries describes the descendant that made the record browsable, and it carries no playback identity, so it must never be treated as a play action. Its route is the record's own series page. The state resolves only after every self-scoped state has been ruled out, so a Series-Shaped record with its own playable Dub keeps that stronger state; a record whose own public route does not resolve stays in the no-option state however playable its descendants are.

The no-option state also governs presentation: catalog evidence may remain
visible for recognition and recovery, but playback-derived controls, progress,
motion, and play affordances must remain absent even when playback-shaped data
is incidentally present.

### Query Language Suggestion

A visible search-bar suggestion produced when the typed query appears to be in a supported language different from the current Search Language. The suggestion can be generous because it is confirm-gated: it does not change Search Language until the viewer accepts it, and unsupported or unrecognized queries leave the current Search Language in control.

### Watch Title Suggestion

A transient, language-scoped completion of a typed Watch title that helps edit
the search draft without becoming a submitted search. Selecting one fills the
draft only; Enter, the mobile Search action, or the visible submit control must
still commit the full search.

Watch Title Suggestions are optional serving responses rather than Watch Search
Analytics: partial prefixes and suggestion selections do not create submitted
search traces or popularity data, and suggestion failure never blocks the
primary search action.

### Keyword-First Search

A Search Pipeline Mode that keeps semantic retrieval available while strengthening lexical and title-driven retrieval so exact or near-title matches are not diluted by broad semantic similarity.

### Title-and-Brand Mode

The automatic final-ranking behavior used when a strong normalized title-lane anchor identifies a known title, brand, series, or collection. It keeps hybrid retrieval active but places strong title and metadata evidence before unrelated transcript-only matches; a query that also includes a concept may use semantic evidence to order the strongly matched content before generic semantic fill.

Title-and-Brand Mode is inferred from the existing query evidence. It is not a Search Pipeline Mode, a user-facing selector, or a separate search surface.

### Semantic Mode

The automatic final-ranking behavior used when a Watch search query has no eligible normalized title-lane anchor. It preserves transcript-driven hybrid discovery for themes, feelings, and natural-language questions.

Semantic Mode retains the normal hybrid Typesense retrieval lanes and is distinct from the separately defined Semantic-Only Search concept.

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

## Recommendations

### Recommendation Request

The immutable root of one versioned, admitted recommendation delivery attempt
for an ephemeral session, seed media item, locale, surface, strategy manifest,
and classifier. It records whether a complete slate or safe reason-coded
unavailable result was prepared and issued, retrieval timing, and one fixed
expiry; failures before safe attribution or during persistence have no root,
and the root is not a viewer profile or a legacy Watch event.

All request-owned evidence inherits the root's retention and is erased with it.

### Recommendation Admission

The pre-delivery capacity gate that decides whether a recommendation attempt
may start for a session and seed while enforcing single-flight, cooldown, and
rate budgets before a Recommendation Request can exist.

A rejected admission is a reason-coded availability result, not an empty or
failed Recommendation Request. Callers may recover from explicitly transient
reasons with a bounded retry while leaving capacity and infrastructure
rejections terminal.

### Recommendation Served Item

One canonical, ordered member of a committed Recommendation Request slate. Its
target, position, presentation, generator, and bounded provenance are server
facts fixed before attribution is issued; browser-supplied values cannot
rewrite them.

### Recommendation Capability

A short-lived, purpose-specific signed authority bound to stored request,
item, session, surface, manifest, and—after handoff—episode/media identity. It
is transported only in same-origin request bodies and browser memory. The
server stores its identifier, digest, and signing key version where needed,
never the raw token.

A tab nonce is non-authoritative correlation. A claim nonce is a one-use
session/media handoff credential; neither is a Recommendation Capability or can
claim a different episode.

### Eligible Recommendation Impression

A recommendation exposure that satisfied the versioned surface visibility
policy, not merely an item that was served or rendered. For
`watch-below-player-v1`, at least half of the card must remain intersecting for
one continuous second while the document is visible.

### Recommendation Evidence

A durable observation that a Recommendation Served Item was rendered, became
an Eligible Recommendation Impression, was selected, or produced an ordered
playback fact. Evidence is attributed through its Recommendation Request and
served-item lineage rather than inferred later from unrelated analytics.

### Recommendation Playback Episode

A source-neutral root for append-only playback evidence, claimed once for one
session and media item. It may carry complete Recommendation Request,
Recommendation Served Item, and selection lineage, but ordinary Watch arrivals
exist without that lineage and keep discovery provenance separate from
attribution.

It carries server-sequenced attempt, start, progress, seek,
active-visible-playing, terminal, and error facts within bounded active and hard
horizons. When visibility coverage is complete, active playback is derived from
the union of foreground-playing intervals, never from wall time, player
position, progress, seeks, or background time; incomplete coverage is retained
as an explicit qualification rather than presented as certain foreground time.

### Recommendation Outcome Revision

An immutable, recomputable classifier result over one episode's ordered fact
watermark and digest. A later fact watermark may append a monotonic superseding
revision; an old retry cannot become latest. `legacy-position-v0` is a named
position/progress comparator with no continuous weight or satisfaction claim,
while active-playback classifiers derive their result from explicit interval
facts. Publication is learning-ineligible; downstream consumers independently
decide whether a revision may influence a particular purpose.

### Recommendation Strategy Manifest

Immutable operator/configuration truth that pins the generator, delivery
contract, surface contract, and slate bound used by a Recommendation Request.
The bootstrap manifest is `semantic-transcript-pgvector-v1`; a separate shared
serving-control row points to it and can stop new issuance without deleting
history.

### Recommendation Profile

A consent-gated, pseudonymous continuity record for anonymous recommendation
personalization. The browser holds the opaque first-party identifier while the
recommendation system retains only its one-way identity and server-owned
interests; withdrawing consent severs relinkable continuity and begins erasure.

### Recommendation Profile Projection

An immutable, bounded interpretation of eligible recommendation behavior into
multiple durable interests and current-session intent. Readers use only a
fully published generation, so an incomplete rebuild cannot become serving
truth and a privacy-generation change fences stale work.

### Recommendation Personalization Decision

The request-owned record that keeps immutable experiment-assignment truth
separate from actual serving truth. `lane` retains the historic assignment
label (`semantic_control`, `profile_challenger`, or `semantic_fallback`) so old
experiment evidence never changes meaning; `executionMode` records whether the
request actually executed semantic contextual retrieval or the versioned
semantic-plus-profile hybrid pipeline. When personalized, the record references
the published Recommendation Profile Projection that authorized profile input,
without exposing profile identifiers, histories, or vectors to Watch or Admin.

### Hybrid Recommendation Manifest

An immutable Recommendation Strategy Manifest whose semantic and
consent-permitted profile generators nominate into one canonical union,
eligibility, deterministic ranker, repetition-aware composer, and exact-six
slate. Semantic-only remains the control, fallback, kill-switch target, and
last-known-good strategy. Historic `profile_challenger` assignment evidence is
not reinterpreted as hybrid; a request proves hybrid execution through its
exact manifest identity and `hybrid_personalized` execution mode.

### Bounded Personalization Experiment

A live anonymous-personalization experiment whose exact Recommendation
Strategy Manifest and cohort limit define its authority. An assignment arm is
authorization and attribution truth, not a candidate-generator selector: an
authorized challenger can execute the exact hybrid manifest while its legacy
`profile_challenger` lane label remains unchanged. Rollback remains an allowed
transition, but wider exposure or permanent-default status creates a new
versioned experiment rather than changing accumulated assignments and evidence
in place.

### Recommendation Evidence-Gate State

The Admin interpretation of durable recommendation-owned evidence. It
distinguishes `healthy` and verified `zero_activity` from
`unavailable_unknown`, `loss_suspected`, `replay`, `conflict`, `late`,
`classifier_lag`, and `retention_overdue`. Absence becomes zero only after a
current database probe, healthy retention, and a durable success watermark;
selection without impression and valid out-of-order evidence remain visible
facts rather than invented loss.

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

### Protected Resource

An OAuth API identified by an exact URI that accepts access tokens only when
their audience names that same resource; it is distinct from the client that
requests the token and from the authorization server that issues it.

### Resource-Bound OAuth Grant

An OAuth authorization grant whose allowed Protected Resources are fixed when
the user authorizes it, carried through authorization-code exchange and refresh,
and never widened by a later token request.

Exchange may select an authorized subset, while refresh remains constrained by
the original grant ceiling.

### First-Party App

One of the project's own applications that the auth provider recognizes as its own rather than as a third-party integration, registered with the provider so it can be issued tokens and have sign-in routed back to it.

Registration is per environment, not per app: an app holds a separate registration for each environment it runs in, each carrying its own client identifier, exact-match redirect targets, allowed browser origins, default scopes, and approval posture. Apps differ in how a person signs in — a browser redirect, a code displayed on one screen and approved on another device, or a native platform credential — but every route resolves to the same person and the same SSO Session. The registry is upsert-only and never prunes: editing a registration is scrubbed into the provider on the next deploy, while removing one from the registry leaves the live registration in place, so retiring an app is a deliberate out-of-band step rather than a deletion from the list.

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

### Experience Draft

The single shared staged version of one language-specific Experience, editable
and previewable without changing that Experience's live version. Each language
has an independent draft and publish lifecycle; saves use last-save-wins
collaboration, while publishing or discarding ends the draft and invalidates its
unlisted preview.

### Experience Duplicate

A new caller-owned Experience created from another Experience's latest saved
effective authored configuration, including each locale's active draft when one
exists. It preserves localized content and template classification but starts
unpublished, without homepage designation, revision history, chat state, or
derived publication data; referenced media remain shared rather than cloned.

### Experience Block

An ordered, schema-validated content unit within an Experience. Blocks carry a discriminator that identifies their content semantics, while presentation variants can change a block's treatment without creating a different content kind; section blocks compose other blocks under a shared visual shell.

### Media Collection Block

An Experience Block that groups ordered watch content beneath independently authored category, title, supporting-title, description, call-to-action, and footer semantics; its presentation variant may change the media layout but not the authored content hierarchy.

### Dynamic Collection Feed

A Media Collection Block whose `itemsSource` is `dynamicCollections`, causing
Web to fill bounded carousel pages from the shared Watch collection feed as the
viewer approaches it. It is still an editor-authored Experience Block: its
position comes from the Experience block sequence, while its generated page
identity is shared across viewers and excludes account or device identity.

### Homepage Experience

The single Experience designated as the watch home for a given locale, resolved per-locale as one curated Experience rather than by listing every Experience. Designation is not rendering: web, mobile, and (as of 2026-07) TV all now render this Experience's rows as their home body, each hydrating a curated item by the item's Core ID through the client's bulk video fetch — supplemented by an on-demand fetch for curated items the client's code-defined pool does not already cover, since an editor can reference content outside that pool. A supplementary hydration record feeds only the Experience rows, never the code-defined featured hero. The featured hero stays code-defined per client — see Home Curation.

### Home Curation

The code-defined content set that fills consumer clients' home screens: a featured hero pool plus ordered content sections, declared in source and fetched by Core ID. Web, mobile, and TV now all source their rows from the Homepage Experience and keep the featured hero pool in code; the code row sections survive only as a frozen fallback rendered when the Experience is unavailable. The featured hero pool stays code-defined — its live half mirrored across clients — while the row sections are no longer mirrored where the Experience is the source.

### Continue Watching

The signed-in continuity behavior: a partially watched video shows a progress bar at the account's latest recorded position, and playback resumes from that position with a start-over option — whichever signed-in device or surface recorded it.

Two mechanisms carry this name and must not be conflated. The account-backed one above is signed-in only: anonymous playback records nothing to the account, nothing merges into the account at a later sign-in, and signing out clears what was recorded locally. Separately, a surface may keep its own local shelf — a per-install list of latest positions with the display fields a home row needs, never synced and never account-scoped — which lets a signed-out viewer resume on that surface alone. The two use independent thresholds for what counts as worth resuming, and a surface holding only the local shelf has no entitlement to read or write account positions.

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

### Bible Passage

The credited scripture text a Watch surface renders for a Bible Citation, resolved server-side and cached by Admin rather than fetched by the client. The Citation is identity — book, chapter, and verse range sourced from Core — while the Passage is the rendered words plus the translation name and copyright line that licence them.

The split matters because a Citation always exists while a Passage may not. Admin returns none when no provider key is configured, when the citation cannot be mapped, or when the translation supplies no copyright string. Attribution is therefore fail-closed by construction: a surface holding verse text always holds the credit that belongs with it.

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

### Forge Subtitle Track

The single browser text track that Watch injects for the subtitle selected from
a Video Edition, distinct from player-generated tracks that are not exposed as
Forge subtitle choices.

It is a public in-page media consumer: its VTT must load through a same-origin
response that remains separate from protected file-download behavior.

### Watch Modal Activity

The aggregate ownership state of every Watch overlay that must suspend route-owned playback, independent of which component renders the overlay or which player is active.

Activity begins when the first owner opens and ends only after the final owner releases through its visible close lifecycle. Resume entitlement belongs to the exact media and source that were playing before activity began; late, replaced, or source-swapped media is paused without inheriting that entitlement.

### Chrome

The auto-hiding controls overlay on the watch video player — the play/pause, scrubber, skip, mute, and fullscreen affordances layered over the footage. Distinct from the captions, which are a separate, always-visible layer that does not hide with it — captions instead lift while it is visible and return when it hides. How far they lift is a judgement about appearance, not about input: captions take no touches, so where a wide cue overlaps a control the cost is how it looks and never a swallowed press, and clearance bought beyond that is paid for on every cue.

The Chrome is visible when playback starts, auto-hides after a few idle seconds while playing, stays up while paused or buffering, and toggles on a tap of the video body. It fades rather than cutting, and is unmounted only after the fade-out completes so a fully-hidden Chrome stops intercepting touches. The home hero's controls are also Chrome; they fade with scroll position rather than idle time, but follow the same rule that hidden Chrome must stop intercepting touches.

A video that starts by itself is the exception to "stays up while buffering": the Chrome is withheld until the first frame and an Autostart Veil stands in for it, because a play button and a zero scrubber offered for a video nobody asked to pause read as a stall. Because the Chrome is the player's only recovery affordance, that withholding is always bounded — see the Autostart Veil's release rule, which binds every layer covering the Chrome and not only the veil itself.

Chrome visibility is not a release signal. Because the Chrome stays up for as long as playback is paused or ended, anything that holds a capability open "until the Chrome hides" holds it open forever in those states. A hold keyed to Chrome visibility therefore needs its own unconditional release, not the Chrome's.

### Autostart Veil

The dimmed cover laid over a video's poster while a video that starts on its own is still loading — darkened artwork under a spinner, standing in for the withheld Chrome. It appears only for a video the viewer did not press play on; a video started by hand shows its Chrome throughout.

The veil takes no touches, and while it is up a tap on the video body must not resolve to hiding the Chrome beneath it, or playback begins with no controls at all. It is released by the first frame, by a reported load failure, or by a time limit — whichever comes first. The time limit is not redundant: the other two releases depend on the player reporting something, and the case that strands a viewer is the one where it reports nothing, so a viewer who leaves the app mid-load and returns must also get the veil released. Releasing early only returns the controls sooner, while releasing late leaves the viewer with no way out, so the bound is set to err early.

The veil is rarely the only thing covering the Chrome — the poster it darkens is a layer in its own right. A release rule that frees the veil while the poster stays leaves the viewer exactly as stranded, so every layer that can cover the Chrome must answer to the same release, not merely the topmost one. Whether a residual poster actually strands anyone depends on paint order rather than on the layers themselves: where the Chrome is drawn by the app it can paint over a leftover poster and nothing is lost, but where the player supplies its own controls inside the video surface, any layer laid over that surface hides them. Passing touches through a covering layer does not resolve this — a control that can be pressed but not seen is not a recovery affordance.

### Back-Swipe Strip

The narrow band along a watch screen's leading edge that is reserved for the platform's page-dismiss swipe. The seek bar spans the full width visually but declines any drag that begins inside the strip, so a dismiss gesture is never half-read as a scrub.

The strip exists because the dismiss gesture is recognised natively, before the app's own gesture handling runs — a contest the app cannot win, only avoid. Reserving territory in advance is therefore the mechanism, rather than deciding the winner once a touch has arrived. It is reserved only where a native gesture actually competes for the touch: where the platform's back gesture belongs to the OS and reaches the app as a plain navigation event, nothing competes, and reserving a strip would delete usable seek area for nothing. Fullscreen playback, which cannot be dismissed by the gesture, likewise reserves none.

### Ambient Backdrop

The soft blurred wash of colour that bleeds from the video's edges into the surrounding screen, filling what would otherwise be flat letterboxing around the player.

It is derived from the video's still artwork rather than from the moving picture, so it is one colour field for the whole video and does not follow the footage from scene to scene. It sits behind every other layer, takes no touches, and fades in rather than appearing at once, so a slow artwork load never flashes.

### Watch Session

The user's current watch state for one Video — which Dub is active, and whether subtitles are on and which track — shared between the video-details screen and the fullscreen player so the language/subtitle pickers and live playback read and write one source of truth.

A Watch Session belongs to the currently-viewed Video: it is published when the details screen resolves its Video and cleared when that screen goes away, and switching the active Dub mid-playback updates the session rather than restarting playback. It is a single shared instance rather than one-per-screen, so when one watch screen is opened from another (e.g. an Up Next episode), the newer screen takes ownership and the earlier screen must re-assert ownership when it regains focus — the focused screen is always the owner, otherwise a returning screen would find the session emptied by the one it spawned. Player features that depend on it (the in-player language/subtitle menu, subtitle rendering) gate on the session matching what is actually playing, so playback started outside a details screen runs without them.

### Watch Preference

The app-wide, persisted audio- and subtitle-language choice that carries across every Video and series — a stored _intent_ (a Language slug plus a cached display name), distinct from the per-Video Watch Session. Because the same preference flows over content with different Dubs and subtitle tracks, it is reconciled against each item's actual tracks at display and apply time rather than shown verbatim: an unsupported choice falls back to a supported track, and content with no matching track reads "Off".

Identity always keys on the Language slug; the cached name paints labels instantly on a cold load but is never used for matching. Toggling subtitles on or off changes visibility only — it never rewrites the stored language, which only an explicit pick changes.

### Player Settings

The viewer's playback speed and Quality Tier for the current playback of one video, offered from the Chrome's settings sheet and applied to whatever the Playback Surface is playing.

They belong to the playing content, not the viewer: they survive presentation changes (fullscreen, backgrounding, the Mini Player) but reset when a different video takes the player over or the viewer's playback ends by dismissal or abandonment — a video that merely plays to its end keeps them, so a replay resumes with the same choices. A stored choice applies only to the content it was chosen for, so a leftover setting can never shape the next video's first load. While a cast receiver drives playback, speed picks go to the receiver and quality is unavailable; a cast session that starts mid-video inherits the current speed.

### Quality Tier

One of the settings sheet's quality choices — an adaptive default plus tiers that constrain which renditions the stream may use, with the top tier a minimum floor rather than a cap so it refuses low renditions instead of duplicating the default.

A tier rides the stream's address rather than a player API, so changing quality reloads the same stream under the new constraint, and within any tier the stream still adapts among the allowed renditions. Only streams whose host supports address-level constraining offer tiers; any other source shows the adaptive default alone or hides the choice.

### Constraint Swap

A reload of the same video admitted because only its Quality Tier changed — the same content under a different constraint, never a change of what is playing.

It is not a session boundary: continue-watching progress and the playback-quality session continue across it, and the Autostart Veil does not re-arm. Playback resumes at the position captured when the tier was picked, restored when the new stream reports loaded rather than when the swap call returns; a swap that neither loads nor errors within a bounded wait releases the resume and reverts the tier.

### Playback Surface

The app's one video player and the single view that draws it, owned above the navigation rather than by any screen, so every screen that shows video borrows it instead of creating its own.

Because there is only ever one, moving video between presentations is a matter of resizing and repositioning that view — never handing playback to a second player, which would restart it and blank the picture. This is what lets a video survive leaving the screen it started on, and why the Mini Player and a Picture-in-Picture Handoff are presentations of the same playback rather than copies of it. A screen that wants video reserves the space it should occupy and publishes a request; the owner draws into that space.

That space is measured rather than declared, and a measurement taken before the reserving screen is really on screen returns nothing at all rather than a wrong answer. So a reservation keeps measuring until it gets an answer instead of trusting a single attempt; until it does, the owner has nowhere to draw and the viewer sees only whatever the reservation itself puts up in the meantime. A reservation that gives up has to say so, because a silent give-up leaves the viewer facing an empty rectangle with nothing to act on and nothing to explain it.

### Fullscreen

The watch player's expanded presentation, in which the video fills the screen in landscape and the surrounding page is hidden. It is the same live playback surface as the inline player, expanded in place rather than handed to a second player, and the page-dismiss swipe is disabled for as long as it is up because a route cannot be popped out from under it.

Entering rotates the app rather than waiting for the viewer to turn the device, so orientation is something the app asserts, not something it observes. That assertion names one specific landscape rather than "either landscape": a permissive choice only _allows_ rotation and then defers to the physical sensor, so a device held upright stays upright and the viewer sees a portrait fullscreen. The accepted cost is that turning the device end-for-end while already in fullscreen does not flip the picture.

Exactly one layer may own orientation. A second writer does not merely duplicate the first — it silently disables it, because the platform asks only one of them and the answer it gets no longer reflects what the app asked for. The lock is also app-wide and lasts until something changes it, rather than belonging to the screen that set it: leaving fullscreen is what restores upright, and a screen that is covered and later uncovered does not re-assert its own orientation on the way back.

### Mini Player

The small floating video window that keeps a video playing after the viewer leaves the screen it was playing on, so playback survives navigation instead of ending with the route. Distinct from the operating system's picture-in-picture window, which is the platform's own window outside the app — the Mini Player is drawn by the app and lives above its navigation.

It is the same live playback surface as the full-size player, resized and repositioned rather than handed to a second player, because moving playback between two surfaces restarts it. A Mini Player is earned rather than automatic: a video that never actually played does not get one, nor does a video that already ran to its end, nor one whose playback is being driven by a cast receiver. While an in-app sheet is presented over it, it is hidden rather than torn down, so the video keeps playing behind the sheet and returns when the sheet closes. The viewer can move it between screen corners and dismiss it; dismissing ends the playback session rather than merely hiding the window.

Shrinking into the window and growing back out of it are one reversible motion, not two independent animations: a transition interrupted part-way turns around from where it currently is rather than restarting from either end, so the video never jumps. Because the same surface is being moved rather than replaced, the window is only ever as correct as the transition's own bookkeeping — a transition that ends without restoring the surface to its resting state leaves the window drawn but empty.

### Picture-in-Picture Handoff

The state in which the operating system's own floating window carries the app's playback after the app has left the foreground, so a video keeps playing outside the app entirely. Distinct from the Mini Player, which the app draws and owns inside its own navigation.

The handoff and the app's departure are not simultaneous, and which comes first is platform-dependent: one platform reports the app backgrounded before the window announces itself, the other completes the handoff before the app is reported backgrounded at all. So a decision that depends on "the window took over" has to be made when the window announces itself; asked at the moment the app is reported backgrounded, the answer is right on one platform and wrong on the other. Because the app cannot know in advance that a handoff is coming, it stops playback on leaving as it would for any other departure, and the window's announcement is what undoes that stop; suppressing the stop in anticipation instead would leave a viewer who has the platform feature switched off playing audio indefinitely.

Closing the window ends playback, while expanding it returns the same playback to the app. Both raise the same signal from the window, so they are told apart by what follows rather than by the signal itself, and a video the viewer paused inside the window stays paused through either. Only a surface armed for automatic entry can be handed off, and a video that was not playing is never handed off at all.

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

### Per-Conversation URL

The address a gate-granted conversation can be reopened from — bookmarked, pasted, or walked with browser back/forward. Minted only once the conversation's server thread provably exists, and only for gate-granted users, because only they can restore history: a merely signed-in or anonymous visitor's address could never resolve, and anonymous chat deliberately never changes its address. In-app selection moves the address without reloading the app; only opening an address from outside re-resolves it on the server. Addresses are per-owner, not shares — the same address opened by anyone else resolves to a Denial Screen, never to the conversation — and they carry no conversation content, so browser history reveals that chat was used, never what was said.

### Adopted Conversation

A conversation row the session creates from a Per-Conversation URL's id alone — an address arrived before any listing proved the conversation exists or belongs to this user. An adopted row starts empty and unproven: its transcript loads through replay, and it becomes a permanent conversation only when a history listing later includes it. Until then it lives under stricter rules than listed rows — a mid-session access denial marks it unavailable rather than silently removing the pane the user deep-linked into, an unproven row whose replay says it is gone is dropped once the user moves away, and an id already found dead this session re-renders its unavailable state from memory instead of asking the server again.

### Denial Screen

The full-pane outcome of opening a Per-Conversation URL that cannot be shown: it replaces the conversation pane while the sidebar stays rendered. Two screens by design. The sign-in screen appears when there is no valid session — anonymous, expired, and tampered are indistinguishable and signing in is the fix, returning to the same conversation afterward (a completed sign-in can still end in denial; that is the model working, not a bug). The unavailable screen covers everything a sign-in cannot fix — another person's conversation, a vanished or erased one, a malformed address, an account the gate denies — with identical wording across those causes so the copy never reveals whether a conversation exists or whose it is. A denial screen never adopts the conversation.

The pane is not the shell. A shell showing a SERVER-DECIDED denial screen is never gate-granted — that is the invariant, and it is what makes such a shell inert: nothing behind the frozen pane fetches conversation data, mutates state, or changes the address on the conversation's behalf, and leaving one is a real navigation that re-resolves who the visitor is. (One narrow exception, unrelated to conversations: a visitor returning from a failed sign-in strips that failure marker from their own address.) The grant cannot override a server-decided denial. But a visitor the gate already grants can meet the same unavailable pane on a LIVE shell — their sidebar, history and address layer keep working, and the pane clears when they open another conversation or start a new one — because withholding a granted person's own history is a cost the denial never needed to impose. So it is the absence of a server-decided denial, not the pane on screen, that leaves a shell live.

### Resource Key

The stable owner identity every Seeker conversation is stored under — a namespaced string distinguishing a signed-in account from an anonymous browser session, with a shared fallback key stamped on internal callers that supply none. The key is treated as opaque past its namespace prefix (matching never splits or parses the remainder), the same value keys the subject's conversations in the persistence store and their traces in observability, and the shared fallback key aggregates many people's turns so nothing keyed to it can be attributed — or erased — per person.

### Subject Erasure

The operator-run deletion of one Resource Key's Seeker data from every store that holds it — conversations and their messages, plus the observability traces keyed to the same value. Erasure matches the full key by exact equality only (never prefix or pattern), previews its blast radius read-only before any destructive run, and refuses outright when what it read cannot prove exactly what it would delete — an unprovable owner or an unaddressable row is an escalation, never a skipped record. Completion is claimed per key erased, never per person: a person's data may span several keys, anonymous keys cannot be discovered from an identity, and data under the shared fallback key is only ever removed by retention aging it out.

### Featured Video

The single library video the Seeker may attach to one reply — a recommendation rendered as an inline player beside the answer, distinct from the cited passages that ground the answer's text.

The model **declares** a pick and never authors its payload: it may only name a video the same turn's own search returned, and every displayed field is re-projected from that search result through shape gates rather than taken from the model. A missing, malformed, or unmatched declaration attaches nothing and is never an error the reader sees. Because replies persist, a featured video is also re-derived when a conversation is replayed, so a replayed reply shows the video the turn featured, though a long title may appear shortened.

### Suggested Follow-Ups

Up to three tappable questions the Seeker offers under a finished answer, proposing where the conversation could go next — generated after the answer's text by a separate minimal model call, so a generation failure or timeout only means the suggestions do not appear; the answer itself is never affected. Tapping one sends that question verbatim as the person's own next message.

Suggestions appear only after grounded, substantive answers, and they are stored with the reply they followed; on replay, only the conversation's latest reply shows its stored suggestions. Turning the capability off stops new suggestions but does not retract stored ones — retraction follows the conversation data's own lifecycle, not the flag.

### JesusFilm RAG

The external `jesusfilm-rag` retrieval service — a standalone system serving biblically aligned content to JFP consumers over a versioned HTTP contract with per-consumer bearer tokens. It is retrieval-only by design ("consumers ask, this service retrieves"): it returns ranked, cited passages, never generated answers, and all audience-specific weighting and generation live in the consumer.

### Managed Prompt

A system prompt whose tunable text lives in Langfuse — versioned, label-addressed, access-controlled — rather than in this public repo, retrieved at runtime by the Mastra prompt helper. Callers may follow a label for candidate intake or pin an immutable version and content hash for production traffic. Runtime retrieval failures and an unconfigured integration degrade to a caller-supplied fallback, so they do not break boot or a chat turn; invalid production URL or allowlist configuration remains intentionally fail-closed at boot. Retrieval-only by design — authoring, versioning, and label moves stay in the Langfuse UI.

The Seeker uses an exact version-and-hash pin for its whole managed system prompt; its `production` label is an alert-only marker rather than a traffic selector. Its compiled outage fallback is reviewed and pinned independently, so managed promotion does not synchronize fallback bytes, but both prompts must preserve the same live tool and safety contract. Managed prompt text must never contain secrets because runtime agent surfaces can return resolved instructions verbatim.

During failure windows the last successfully fetched prompt keeps serving (serve-stale) in preference to the fallback — so deleting a prompt or revoking a key does not retract text already cached in a running process. Retraction is a label move (effective within one cache TTL, and only while the prompt still exists and the credential is trusted) or a restart with the configuration removed — the only path that works after a deletion, a revocation, or against a hostile key; the fallback serves only when no managed text was ever cached.

### Seeker Eval Experiment

A predeclared comparison of Seeker behavior against a declared production benchmark, changing exactly one causal axis while holding every other execution identity dimension constant.

Its manifest is an executable contract: supported identity dimensions control the run, every declared dimension is attested by the evidence, unsupported configurations refuse, and any reused evidence must match the declared identity and eligibility policy.

### Experiment Attempt

One append-only execution record within a Seeker Eval Experiment, preserving either complete benchmark evidence or a diagnostic refusal or failure without rewriting earlier attempts.

An attempt is complete only after its required inventoried evidence has passed aggregate-schema, identity, sensitive-content, and inventory checks and its immutable completion record has been published; package eligibility additionally requires rejecting untracked sidecars.

Once attempt bytes reach the repository's base branch they are historical evidence: later changes create a new attempt or experiment rather than modifying, deleting, renaming, or completing those bytes in place. A terminal verdict seals its whole experiment.

## Telemetry triage

### Triage Signal

One unit of detected activity a triage sweep may act on: a grouped error issue, a monitor alert episode, or a spike in an aggregate count. The kind decides what evidence is available and which dedup rules apply. Everything downstream — judgment, ticket text, dedup identity — is keyed to the signal rather than to the individual events behind it.

### Service Baseline

The standing activity a covered service already had when triage began watching it, recorded on that service's first covered run.

That first run deliberately files nothing: it exists so pre-existing errors read as pre-existing instead of as a sudden flood of new ones. A read the sweep could not complete refuses to seed a baseline at all, because a partial view recorded as "everything that existed" would make the unseen remainder look new forever.

### Release-Session Filter

The gate deciding whether a Triage Signal's activity came from a real release build or from a developer's own session, so development noise never becomes a triage ticket. The version the activity carries is the primary discriminator; textual development markers are secondary, used only when no version is present.

It fails open toward coverage: activity spanning both a development session and a release build stays in, and an unusable filter configuration refuses to run rather than silently excluding everything. Loosening the filter makes previously excluded noise look new, so a filter change requires re-seeding the affected Service Baseline.

### Epoch

The dedup generation of a Triage Signal — the counter that decides whether an already-ticketed problem may be ticketed again.

A signal ticketed once stays quiet at that epoch however long the problem persists. Only a regression past a configured multiple of the signal's recorded baseline mints the next epoch, and minting records the regressed level as the new baseline, so an elevated but stable problem does not re-fire on every sweep.

### Withheld Signal

A signal a run read or judged but deliberately did not commit state for, so the next run reads it again from the same point.

Withholding is the sweep's response to any uncertainty it cannot resolve — a failed judgment, an exhausted time budget, a ticket the outbox could not durably record. It trades a duplicate read for the guarantee that nothing is silently dropped. The alternative, advancing state past work that did not complete, loses the signal permanently.

### Ticket Outbox

The durable queue every externally created triage ticket passes through, so that deciding to file and actually filing are separate, restartable steps.

The per-day ticket budget is enforced inside the claim that reserves work rather than by the caller, so concurrent or restarted runs cannot exceed it together. Signal state commits only after the outbox row is durable; refusing the state write when that row is absent is what stops a run from recording "handled" for a ticket nothing ever queued. Work that does not fit the budget stays queued for a later day rather than expiring.

### Untrusted Evidence

External text a triage or research pipeline reads and then reproduces — an error message, a stack frame, a support conversation — which anyone who can reach the upstream system can influence.

It is hostile input at two distinct boundaries, and neither boundary's control substitutes for the other's. At the model turn, delimiters keep it from reading as instructions. At the human-facing artifact, a sanitizer neutralizes links and markers before the text is written into a ticket a reader will click.

## Flagged ambiguities

- "Contextual Watch Route" and "canonical Watch URL" are not synonyms: the contextual route preserves collection navigation, while the Standalone Watch Route owns discovery, social, and sharing identity.
- "Evidence" names two unrelated things and should always be qualified: **Semantic Evidence** is the content fragment explaining why a search result matched, while **Untrusted Evidence** is attacker-influenceable upstream text a pipeline must neutralize before use.
- "Showcase" names two unrelated TV surfaces that are close to opposites, and neither is a variant of the other: **Showcase Mode** is the unattended autoplaying reel, while the **Focus-Driven Showcase** is Home's canvas that follows D-pad focus and deliberately mounts no video player. Always qualify which one is meant.
- "Search Passport" had named a known-caller check as though it were specific to search, and as though it gated access there. Both are wrong: the check is a general known-caller concept, and the public search surface admits anonymous callers — a key there selects Rate-Limit Identity only. Use **Known-Caller Check**, and say explicitly whether a given surface gates on it.
- "Chapter" carries two unrelated meanings. A **Chapter** is a segment of one feature film (a catalog relationship); a **felt-need chapter** is a themed section of Showcase Mode's reel, announced by a Chapter Card. Qualify which is meant whenever both surfaces are in scope.
- "Episode" had been used loosely for any child Video, which is what let a film's Chapters be counted and billed as episodes. An Episode is a child of a series and stands alone; a film's children are Chapters.
- "Description" is ambiguous for a Video's localized copy: a locale carries both a short authored snippet and a longer catalog description, and which one a surface shows is decided per surface, not per client. The watch-home hero and the video watch page prefer the snippet and fall back to the description; the series page body, SEO metadata, and structured data prefer the description and fall back to the snippet. So a request to change or remove "the description" may act on either field — name the surface, and check its fallback order before assuming which.
