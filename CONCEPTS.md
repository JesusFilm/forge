# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Video & media

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

### Match Job

An asynchronous attribution request that owns an uploaded media input until the mapper can process it and return ranked results.

### Match Candidate

A ranked possible attribution produced by a Match Job, pairing a source Video with its likely Dub and a confidence judgment.

## Search & embeddings

### Content Embedding

A vector representation of localized content used for semantic retrieval across videos, scenes, transcripts, and experiences. Content Embeddings are only comparable when the query vector and stored document vectors come from the same provider contract and transform behavior.

### Embedding Provenance

The metadata that says which provider contract produced a stored Content Embedding and how that vector was transformed before storage. Provenance is part of search correctness: it prevents legacy vectors, newly generated vectors, and future provider variants from being treated as the same embedding space.

### Provider-Bound Gate

An evaluation or backfill approval artifact that binds quality evidence to a specific embedding provider contract before high-churn content vectors are rewritten. A Provider-Bound Gate needs both configuration provenance and corpus provenance: it must show what the system is configured to generate and what stored rows the evaluation actually searched.

## Admin schema operations

### Forward-Only Migration

A database schema change that is reversed by moving the schema forward again, not by editing or deleting migration history that a deployed database may already have observed. Failed-up recovery and successful-up rollback are different paths: failed attempts can be marked rolled back after cleanup, while successful attempts need a new migration to undo them.

### Known Recoverable Migration

A migration failure state the team has classified as safe for automated failed-row recovery after the root cause or partial schema state is understood. The classification applies only to failed migration rows; it does not mean a successfully applied migration can be removed from history.

## Watch experiences

### Experience

A curated, themed watch page — such as Easter or Christmas — that assembles a selection of watch content under an editorial frame. An Experience is authored in admin (hand-curated by the editorial team, or AI-generated) and published to render as its own standalone page on the watch site, reachable by a public slug of its own (distinct from any single Video's slug).

### Homepage Experience

The single Experience designated as the watch home for a given locale — the landing screen a consumer client (web, mobile, TV) renders by default. It is resolved per-locale as one curated Experience, not by listing every Experience; consumer clients reach it by its slug like any other Experience.

## Watch player UI

### Chrome

The auto-hiding controls overlay on the watch video player — the play/pause, scrubber, skip, mute, and fullscreen affordances layered over the footage. Distinct from the captions, which are a separate, always-visible layer that does not hide with it.

The Chrome is visible when playback starts, auto-hides after a few idle seconds while playing, stays up while paused or buffering, and toggles on a tap of the video body. It fades rather than cutting, and is unmounted only after the fade-out completes so a fully-hidden Chrome stops intercepting touches.
