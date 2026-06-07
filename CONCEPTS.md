# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Video & media

### Video

A piece of watchable content — a feature film, a segment of one, or a container node (series, collection) in a parent/child tree. A Video is not directly playable on its own: its watchable audio comes from its Dubs and its subtitles from a Video Edition. Videos relate to each other as parents and children, which is how series and their episodes — and "Up Next" siblings — are formed.

### Dub

One audio-language variant of a Video — the unit the watch screen's language picker selects (a popular title can have thousands of Dubs). A Dub carries its own playable stream and its own set of downloadable renditions, and points at the Video Edition whose subtitle tracks apply to it.
_Avoid:_ variant (the mobile client aliases Dubs as "variants").

### Video Edition

A cut/edition of a Video that owns the subtitle tracks. Subtitles hang off the Edition, not off individual Dubs — a Dub references the Edition whose subtitles apply, so many Dubs sharing an edition share one set of subtitle tracks.

### Language

A language a Video is offered in: every Dub is for one Language, and subtitle tracks are per-Language. A Language has two identifiers that are easy to conflate — a unique, stable slug that is its identity (e.g. korean, kurmanji-standard), and a BCP-47 tag that is a locale label (e.g. ko, ko-kmr) and is deliberately not unique per language, so distinct Languages can share a tag or its prefix. Identity comparisons — persisting or re-selecting a user's chosen language — key on the slug; the BCP-47 tag is only for best-effort device-locale matching.

## Search & embeddings

### Content Embedding

A vector representation of localized content used for semantic retrieval across videos, scenes, transcripts, and experiences. Content Embeddings are only comparable when the query vector and stored document vectors come from the same provider contract and transform behavior.

### Embedding Provenance

The metadata that says which provider contract produced a stored Content Embedding and how that vector was transformed before storage. Provenance is part of search correctness: it prevents legacy vectors, newly generated vectors, and future provider variants from being treated as the same embedding space.

### Provider-Bound Gate

An evaluation or backfill approval artifact that binds quality evidence to a specific embedding provider contract before high-churn content vectors are rewritten. A Provider-Bound Gate needs both configuration provenance and corpus provenance: it must show what the system is configured to generate and what stored rows the evaluation actually searched.
