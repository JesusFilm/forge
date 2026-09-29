---
title: "Group RAG source brands without changing retrieval identity"
date: "2026-09-29"
module: "RAG portal Sources"
problem_type: "architecture"
tags: [rag, portal, source-identity, snapshot, language]
---

# Source brands are a portal projection

RAG's domain-oriented acquisition keys are used in document identity, retrieval
allowlists and citations. A multilingual source catalog needs fewer human-facing
rows, but changing those keys would turn a presentation change into a corpus and
consumer migration.

Keep explicit brand membership in
`apps/rag/src/serving/http/portal-source-brands.ts`. The serving projection in
`portal-sources.ts` combines only positive document counts from the committed
production snapshot. Display IDs are namespaced and never used as consumer
source keys. Unmapped entries remain independent; names and domain prefixes do
not establish shared brand identity.

Check expected languages on each original key before aggregating. If Dutch is
expected on one domain and unexpectedly detected on an Albanian sibling, a
brand-wide expected-language union would conceal the anomaly. Preserve counts
and the contributing domain on each language cell. Unidentified-language
counts belong in total documents exactly once and do not increase the count of
detected languages. Domain sums describe stored documents, not unique articles
across domains.

Reuse the committed dashboard artifact through an authenticated portal read.
The release's `provenance.fetched_at` is the observation time, even if deployment
or frontend work happens later. Cache only successful reads for that process;
missing or invalid inventory should fail Sources alone, never retrieval or the
rest of the portal. This requires neither production reporting credentials in
the portal nor a second refresh workflow.

Lazy-load the catalog UI and data on navigation, then clear view data on exit or
session denial. Discard late responses using a view generation counter. Verify
both initial request deferral and actual Sources activation, including a
250-plus-language fixture, rather than treating a screenshot as performance
proof.
