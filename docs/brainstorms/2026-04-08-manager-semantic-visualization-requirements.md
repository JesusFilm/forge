---
date: 2026-04-08T00:00:00.000Z
topic: manager-semantic-visualization
---

# Semantic Visualization Workbench for Manager App

## Problem Frame

The roadmap already treats clustering and embeddings as critical inputs for topic generation, but the manager app offers no operator-facing way to see how videos relate. That means teams cannot inspect whether AI-created clusters resemble the human-made collections they expect, whether near-neighbor matches are sensible, or where the topic graph is weak. A visual workbench is needed to make the semantic layer understandable.

## Requirements

- R1. Add a semantic visualization route in the manager app for exploring topic clusters and vector relationships.
- R2. The default view presents natural media clusters as collection cards with names, confidence, size, and representative videos.
- R3. A graph view renders videos and clusters as connected nodes in an Obsidian-like relationship map.
- R4. Selecting a video reveals its nearest vector matches, cluster membership, similarity score, and source metadata topics.
- R5. Selecting a cluster reveals why the cluster exists: centroid label, source topics, related clusters, and outlier videos.
- R6. Operators can apply light curation actions such as pin, hide, rename, split candidate, or mark as misleading for later retraining.
- R7. Topic-page generation workflows can launch from a cluster once an operator is satisfied with its shape.

## Success Criteria

- A human reviewer can explain why two videos are grouped together without reading raw embeddings.
- Bad clusters and false-positive vector matches are obvious enough to correct before downstream topic generation.
- The visual model feels closer to a knowledge graph than a spreadsheet export.

## Scope Boundaries

- Not a public-facing graph experience.
- Not a replacement for the clustering algorithm itself.
- Not a high-dimensional research tool for data scientists; this is an operator UI.

## Key Decisions

- The workbench starts with cluster and graph views because both are needed: one for curation, one for intuition.
- Human intervention is intentionally lightweight; operators guide the semantic model rather than hand-curate every edge.
- Bible video topic pages are downstream actions from reviewed clusters, not a separate starting point.

## Dependencies / Assumptions

- Topic clustering artifacts from the planned clustering service are available as the primary data source.
- Embedding similarity remains the canonical relationship score even when the UI adds human-readable explanations.

## Outstanding Questions

### Deferred to Planning

- [Affects R3][Technical] Should the graph render all nodes client-side, or should it stream a pruned neighborhood around the current selection?
- [Affects R6][Technical] Where should lightweight curation state live first: CMS, manager-only storage, or artifact-side overlays?

## Next Steps

-> `/ce:plan` for structured implementation planning
