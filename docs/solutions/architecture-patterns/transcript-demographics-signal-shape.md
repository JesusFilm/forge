---
title: "Transcript demographics signal shape for enriched embeddings"
last_updated: 2026-06-18
problem_type: architecture_pattern
component: service_object
severity: medium
module: apps/mastra
date: 2026-06-18
applies_when:
  - "Adding audience or persona signals to transcript embedding input text"
  - "Debugging why a demographic query does or does not retrieve transcript chunks"
  - "Extending enriched transcript metadata stored on video_transcript_chunk"
tags:
  - transcript-embedding
  - demographics
  - mastra
  - semantic-search
  - pgvector
  - metadata
related_components:
  - apps/admin
  - video_transcript_chunk
related:
  - "docs/solutions/architecture-patterns/admin-semantic-video-transcript-evidence-pattern.md"
  - "docs/solutions/platform/mastra-transcript-embedding-workflow-pattern.md"
  - "docs/solutions/platform/admin-transcript-embeddings-vector-reuse-pattern.md"
  - "docs/solutions/database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md"
---

# Transcript Demographics Signal Shape

## Context

feat-192 moved semantic video search toward enriched transcript chunks as the
source of truth and removed runtime scene-retrieval consumption. The transcript
embedding input now needs enough structured signal to replace the useful parts
of scene embeddings: felt needs, scripture, content summary, tone, spiritual
context, time range, and demographics.

Demographics were added after the initial enriched transcript work so queries
like "for parents", "for children", or "for people in crisis" can match the
vector text and also be inspected from stored metadata.

## Guidance

Treat demographics as a controlled, transcript-grounded taxonomy. The current
canonical values are:

- `Children`
- `Youth`
- `Young Adults`
- `Parents`
- `Families`
- `Women`
- `Men`
- `Religious Leaders`
- `Disciples`
- `Seekers`
- `Outsiders`
- `People in Crisis`

The extraction is intentionally deterministic and cue-based. It scans the raw
subtitle/transcript text for explicit words such as `children`, `parents`,
`family`, `disciples`, `pharisees`, `widows`, `sick`, or `prisoners`. Do not
silently infer demographics from title, video type, or broad ministry
intuition unless the product decision changes and the strategy version changes
with it.

Each enriched chunk folds demographics into the text sent to the embedding
provider:

```text
Time range: 01:05-01:10
Felt needs: Hope, Love
Bible verses: John 3:16
Summary: Jesus gives hope and love to children and parents in the family in John 3:16.
Tone: reflective
Demographics: Children, Parents, Families
Spiritual context: Bible reference
Transcript: Jesus gives hope and love to children and parents in the family in John 3:16.
```

The same values are stored structurally on the chunk:

```ts
{
  demographics: ["Children", "Parents", "Families"],
  extractionMetadata: {
    strategy: "deterministic-transcript-grounded-v1",
    source: "transcript",
    demographicsStrategy: "explicit-cue-taxonomy-v1",
  },
}
```

Admin persists the array to `video_transcript_chunk.demographics` as a Postgres
`text[]` column and also stores the full embedding input text in
`video_transcript_chunk.embedding_input_text`. This is the important split:
the vector sees the `Demographics:` line, while operators and future filters
can read the structured array without reverse-engineering the embedded text.

## Why This Matters

Search quality depends on demographic words being part of the embedded text,
not just metadata beside the vector. A query for "children", "parents",
"disciples", or "people in crisis" needs those concepts in the same semantic
space as the transcript chunk.

At the same time, keeping demographics structured lets future search surfaces
filter, debug, and display audience signals without re-running embeddings.
That matters for staged backfills: a row can be checked for enriched-v2 shape
by looking for fields like `embedding_input_text`, `demographics`, and
`extraction_metadata`.

## When to Apply

Use this pattern for transcript-level audience signals that are present in the
source text. If a future version wants video-level audience inference, add a
new strategy name and make the provenance explicit, for example
`video-context-taxonomy-v2`. Do not overload
`explicit-cue-taxonomy-v1` with broader inference rules.

When adding a new canonical demographic value:

1. Update the `CanonicalDemographic` union in the Mastra transcript embedding
   workflow.
2. Add explicit cue rules in `inferDemographics`.
3. Add or update tests that assert both the structured array and the
   `Demographics:` embedding input line.
4. Confirm Admin ingest persists the new value through the `text[]` bulk insert
   path.

## Examples

Transcript text:

```text
Jesus welcomes the children and blesses the families who brought them.
```

Expected enriched fields:

```ts
{
  demographics: ["Children", "Families"],
  embeddingInputText: [
    "Demographics: Children, Families",
    "Transcript: Jesus welcomes the children and blesses the families who brought them.",
  ].join("\n"),
}
```

Transcript text:

```text
The Pharisees asked him a question while the disciples listened.
```

Expected enriched fields:

```ts
{
  demographics: ["Religious Leaders", "Disciples", "Seekers"],
}
```

No explicit cue:

```text
Jesus went up the mountain and began to teach.
```

Expected enriched field:

```text
Demographics: None
```

The absence of a demographic is useful information. It keeps the vector from
claiming a target audience that is not grounded in the transcript segment.
