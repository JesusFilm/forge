# DS Year 1 Roadmap — April to May 2026

## Goal

Build trusted, scalable AI capabilities that help people discover gospel content, engage meaningfully with Scripture, and take faithful next steps.

## Status (March 30, 2026)

- **Media Generation**: ~55% complete. Subtitle/transcript pipeline production-ready, translation working, voiceover designed but unimplemented.
- **Content Discovery**: ~30% complete. AI enrichment pipeline generates embeddings, metadata, topics — but nothing flows back to CMS or powers user-facing features.
- **Topic Experiences**: ~10% complete. Experience block system exists, but no Topic content type, no AI generation, no topic pages.

## April–May Deliverables

1. **Semantic Search Architecture** — vector DB, search API, search UI on web and mobile
2. **AI-Assisted Topic Experiences** — Topic content type, AI generation pipeline producing tens of thousands of pages, topic UI
3. **Audio AI Generation** — voiceover/TTS service in the manager pipeline

## Feature Index

### Content Discovery

| ID                                                                    | Feature                               | Owner | Priority | Timeline | Status      |
| --------------------------------------------------------------------- | ------------------------------------- | ----- | -------- | -------- | ----------- |
| [feat-009](content-discovery/feat-009-pgvector-embedding-indexing.md) | pgvector Setup and Embedding Indexing | nisal | P0       | Week 2-3 | not-started |
| [feat-010](content-discovery/feat-010-semantic-search-api.md)         | Semantic Search API                   | nisal | P0       | Week 3-5 | not-started |
| [feat-011](content-discovery/feat-011-search-ui-web.md)               | Search UI — Web                       | urim  | P0       | Week 3-5 | not-started |
| [feat-012](content-discovery/feat-012-search-ui-mobile.md)            | Search UI — Mobile                    | urim  | P0       | Week 3-5 | not-started |

### Topic Experiences

| ID                                                                        | Feature                                   | Owner     | Priority | Timeline | Status      |
| ------------------------------------------------------------------------- | ----------------------------------------- | --------- | -------- | -------- | ----------- |
| [feat-001](topic-experiences/feat-001-architecture-contracts.md)          | Architecture Contracts                    | tataihono | P0       | Week 1   | not-started |
| [feat-002](topic-experiences/feat-002-wire-enrichment-metadata-to-cms.md) | Wire Enrichment Metadata Back to CMS      | vlad      | P0       | Week 1-2 | not-started |
| [feat-003](topic-experiences/feat-003-topic-content-type.md)              | Topic Content Type in Strapi              | nisal     | P0       | Week 1-2 | not-started |
| [feat-007](topic-experiences/feat-007-topic-clustering.md)                | Topic Clustering from Enriched Metadata   | ekkasit   | P0       | Week 1-3 | not-started |
| [feat-008](topic-experiences/feat-008-experience-block-templates.md)      | Experience Block Template System          | ekkasit   | P0       | Week 2-4 | not-started |
| [feat-020](topic-experiences/feat-020-ai-topic-content-generation.md)     | AI Topic Content Generation Service       | vlad      | P2       | Week 5-8 | not-started |
| [feat-015](topic-experiences/feat-015-bulk-experience-write-api.md)       | Bulk Experience Write API                 | nisal     | P1       | Week 3-5 | not-started |
| [feat-013](topic-experiences/feat-013-bulk-experience-generation.md)      | Bulk Experience Generation Pipeline       | ekkasit   | P0       | Week 3-8 | not-started |
| [feat-016](topic-experiences/feat-016-topic-experience-graphql.md)        | Topic / Experience GraphQL Wiring         | nisal     | P1       | Week 5-8 | not-started |
| [feat-017](topic-experiences/feat-017-topic-browsing-web.md)              | Topic Browsing — Web                      | urim      | P1       | Week 4-7 | not-started |
| [feat-018](topic-experiences/feat-018-topic-browsing-mobile.md)           | Topic Browsing — Mobile                   | urim      | P1       | Week 5-8 | not-started |
| [feat-021](topic-experiences/feat-021-generation-quality-monitoring.md)   | Generation Quality & Monitoring Dashboard | ekkasit   | P2       | Week 6-8 | not-started |

### Media Generation

| ID                                                             | Feature                            | Owner | Priority | Timeline | Status      |
| -------------------------------------------------------------- | ---------------------------------- | ----- | -------- | -------- | ----------- |
| [feat-014](media-generation/feat-014-voiceover-tts-service.md) | Voiceover / Text-to-Speech Service | vlad  | P1       | Week 3-6 | not-started |

### Platform

| ID                                                            | Feature                      | Owner     | Priority | Timeline | Status      |
| ------------------------------------------------------------- | ---------------------------- | --------- | -------- | -------- | ----------- |
| [feat-004](platform/feat-004-web-app-onboarding.md)           | Web App Onboarding           | urim      | P0       | Week 1-2 | not-started |
| [feat-005](platform/feat-005-graphql-contract-stewardship.md) | GraphQL Contract Stewardship | tataihono | P0       | Week 1-8 | not-started |
| [feat-006](platform/feat-006-code-review-unblocking.md)       | Code Review and Unblocking   | tataihono | P0       | Week 1-8 | not-started |
| [feat-019](platform/feat-019-scaffolding-support-urim.md)     | Scaffolding Support for Urim | tataihono | P1       | Week 2-4 | not-started |

## Dependency Chain

```
Tataihono (contracts week 1) ──→ Everyone
Vlad (metadata sync) ──→ Ekkasit (AI input for generation)
Nisal (topic type + bulk API + search API) ──→ Ekkasit (writes) + Urim (reads)
Ekkasit (generates Experiences at scale) ──→ Urim (renders them)
Urim (web + mobile) ──→ end user
```

## Sequencing

```
Week 1-2 (April 1-11)
├── Tataihono: Architecture decisions, contracts, schemas
├── Vlad: Wire enrichment metadata → CMS
├── Nisal: Topic content type in Strapi
├── Ekkasit: AI generation pipeline design + prototyping
└── Urim: Web app onboarding, existing mobile polish

Week 3-4 (April 14-25)
├── Vlad: Voiceover/TTS service
├── Nisal: pgvector + search API
├── Ekkasit: Topic clustering + Experience generation
├── Urim: Web + mobile search UI
└── Tataihono: Review, unblock, GraphQL stewardship

Week 5-8 (April 28 – May 30)
├── Vlad: Voiceover polish + AI topic content generation service
├── Nisal: Bulk write API + Topic ↔ Experience wiring
├── Ekkasit: Scale to tens of thousands of generated Experiences
├── Urim: Web + mobile topic pages, browsing, navigation
└── Tataihono: Integration, review, architecture refinement
```

## Lanes

- **content-discovery**: Search infrastructure and UI (feat-009 through feat-012)
- **topic-experiences**: Topic content types, clustering, generation, and browsing UI (feat-001 through feat-003, feat-007, feat-008, feat-013, feat-015 through feat-018, feat-020, feat-021)
- **media-generation**: Audio/voice generation (feat-014)
- **platform**: Onboarding, architecture, code review, scaffolding (feat-004 through feat-006, feat-019)
