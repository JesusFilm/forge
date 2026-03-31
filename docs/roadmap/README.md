# DS Year 1 Roadmap

## Goal

Build trusted, scalable AI capabilities that help people discover gospel content, engage meaningfully with Scripture, and take faithful next steps.

## Status (March 31, 2026)

### Completed (Feb – Mar 2026)

- **Platform Foundation**: 6 features complete, 1 in progress. CMS content modeling, GraphQL pipeline, infrastructure (AWS → Railway), content sync pipeline, roadmap dashboard, and tooling all shipped.
- **Topic Experiences (Foundation)**: 4 features complete. Web experience pages, Expo mobile app, iOS native app, and Easter experience all live in production.
- **Media Generation (Foundation)**: 1 feature complete, 1 in progress. Video content discovery dashboard shipped, AI enrichment pipeline underway.

### Planned (April – May 2026)

- **Content Discovery**: 4 features planned. Semantic search architecture — vector DB, search API, search UI on web and mobile.
- **Topic Experiences (Next Phase)**: 12 features planned. Topic content type, AI generation pipeline, bulk experience generation, topic browsing UI.
- **Media Generation (Next Phase)**: 1 feature planned. Voiceover/TTS service.
- **Platform (Next Phase)**: 4 features planned. Web app onboarding, GraphQL stewardship, code review, scaffolding support.

## April–May Deliverables

1. **Semantic Search Architecture** — vector DB, search API, search UI on web and mobile
2. **AI-Assisted Topic Experiences** — Topic content type, AI generation pipeline producing tens of thousands of pages, topic UI
3. **Audio AI Generation** — voiceover/TTS service in the manager pipeline

## Feature Index

### Content Discovery

| ID                                                                    | Feature                               | Owner | Priority | Start  | Days | Status      |
| --------------------------------------------------------------------- | ------------------------------------- | ----- | -------- | ------ | ---- | ----------- |
| [feat-009](content-discovery/feat-009-pgvector-embedding-indexing.md) | pgvector Setup and Embedding Indexing | nisal | P0       | Apr 7  | 14   | not-started |
| [feat-010](content-discovery/feat-010-semantic-search-api.md)         | Semantic Search API                   | nisal | P0       | Apr 14 | 21   | not-started |
| [feat-011](content-discovery/feat-011-search-ui-web.md)               | Search UI — Web                       | urim  | P0       | Apr 14 | 21   | not-started |
| [feat-012](content-discovery/feat-012-search-ui-mobile.md)            | Search UI — Mobile                    | urim  | P0       | Apr 14 | 21   | not-started |

### Topic Experiences

#### Completed

| ID                                                              | Feature                                     | Owner   | Priority | Start  | Days | Status   |
| --------------------------------------------------------------- | ------------------------------------------- | ------- | -------- | ------ | ---- | -------- |
| [feat-023](topic-experiences/feat-023-web-experience-pages.md)  | Web Experience Pages                        | nisal   | P0       | Feb 17 | 31   | complete |
| [feat-024](topic-experiences/feat-024-mobile-app-expo.md)       | Mobile App — Expo                           | ekkasit | P0       | Mar 2  | 28   | complete |
| [feat-025](topic-experiences/feat-025-mobile-app-ios-native.md) | Mobile App — iOS Native                     | urim    | P0       | Feb 25 | 16   | complete |
| [feat-029](topic-experiences/feat-029-easter-experience.md)     | Easter Experience (First Production Launch) | nisal   | P0       | Mar 10 | 21   | complete |

#### Planned

| ID                                                                        | Feature                                   | Owner     | Priority | Start  | Days | Status      |
| ------------------------------------------------------------------------- | ----------------------------------------- | --------- | -------- | ------ | ---- | ----------- |
| [feat-001](topic-experiences/feat-001-architecture-contracts.md)          | Architecture Contracts                    | tataihono | P0       | Apr 1  | 7    | not-started |
| [feat-002](topic-experiences/feat-002-wire-enrichment-metadata-to-cms.md) | Wire Enrichment Metadata Back to CMS      | vlad      | P0       | Apr 1  | 14   | not-started |
| [feat-003](topic-experiences/feat-003-topic-content-type.md)              | Topic Content Type in Strapi              | nisal     | P0       | Apr 1  | 14   | not-started |
| [feat-007](topic-experiences/feat-007-topic-clustering.md)                | Topic Clustering from Enriched Metadata   | ekkasit   | P0       | Apr 1  | 21   | not-started |
| [feat-008](topic-experiences/feat-008-experience-block-templates.md)      | Experience Block Template System          | ekkasit   | P0       | Apr 7  | 21   | not-started |
| [feat-020](topic-experiences/feat-020-ai-topic-content-generation.md)     | AI Topic Content Generation Service       | vlad      | P2       | Apr 28 | 28   | not-started |
| [feat-015](topic-experiences/feat-015-bulk-experience-write-api.md)       | Bulk Experience Write API                 | nisal     | P1       | Apr 14 | 21   | not-started |
| [feat-013](topic-experiences/feat-013-bulk-experience-generation.md)      | Bulk Experience Generation Pipeline       | ekkasit   | P0       | Apr 14 | 42   | not-started |
| [feat-016](topic-experiences/feat-016-topic-experience-graphql.md)        | Topic / Experience GraphQL Wiring         | nisal     | P1       | Apr 28 | 28   | not-started |
| [feat-017](topic-experiences/feat-017-topic-browsing-web.md)              | Topic Browsing — Web                      | urim      | P1       | Apr 21 | 28   | not-started |
| [feat-018](topic-experiences/feat-018-topic-browsing-mobile.md)           | Topic Browsing — Mobile                   | urim      | P1       | Apr 28 | 28   | not-started |
| [feat-021](topic-experiences/feat-021-generation-quality-monitoring.md)   | Generation Quality & Monitoring Dashboard | ekkasit   | P2       | May 5  | 21   | not-started |

### Media Generation

#### Completed / In Progress

| ID                                                                         | Feature                           | Owner | Priority | Start  | Days | Status      |
| -------------------------------------------------------------------------- | --------------------------------- | ----- | -------- | ------ | ---- | ----------- |
| [feat-030](media-generation/feat-030-video-content-discovery-dashboard.md) | Video Content Discovery Dashboard | vlad  | P0       | Mar 18 | 7    | complete    |
| [feat-031](media-generation/feat-031-ai-video-enrichment-pipeline.md)      | AI Video Enrichment Pipeline      | vlad  | P0       | Mar 18 | 13   | in-progress |

#### Planned

| ID                                                             | Feature                            | Owner | Priority | Start  | Days | Status      |
| -------------------------------------------------------------- | ---------------------------------- | ----- | -------- | ------ | ---- | ----------- |
| [feat-014](media-generation/feat-014-voiceover-tts-service.md) | Voiceover / Text-to-Speech Service | vlad  | P1       | Apr 14 | 28   | not-started |

### Platform

#### Completed / In Progress

| ID                                                            | Feature                                        | Owner     | Priority | Start  | Days | Status      |
| ------------------------------------------------------------- | ---------------------------------------------- | --------- | -------- | ------ | ---- | ----------- |
| [feat-022](platform/feat-022-cms-foundation.md)               | CMS Foundation (Strapi v5 Content Modeling)    | tataihono | P0       | Feb 17 | 24   | complete    |
| [feat-026](platform/feat-026-graphql-pipeline.md)             | GraphQL Pipeline (Contract-First Typed Client) | tataihono | P0       | Feb 12 | 47   | complete    |
| [feat-027](platform/feat-027-infrastructure-evolution.md)     | Infrastructure Evolution (AWS → Railway)       | tataihono | P0       | Mar 3  | 28   | complete    |
| [feat-028](platform/feat-028-content-sync-pipeline.md)        | Content Sync Pipeline (Core Sync)              | nisal     | P0       | Mar 20 | 11   | complete    |
| [feat-032](platform/feat-032-tooling-developer-experience.md) | Tooling & Developer Experience                 | tataihono | P0       | Feb 12 | 47   | in-progress |
| [feat-033](platform/feat-033-roadmap-dashboard-app.md)        | Roadmap Dashboard App                          | tataihono | P0       | Mar 30 | 2    | complete    |

#### Planned

| ID                                                            | Feature                      | Owner     | Priority | Start | Days | Status      |
| ------------------------------------------------------------- | ---------------------------- | --------- | -------- | ----- | ---- | ----------- |
| [feat-004](platform/feat-004-web-app-onboarding.md)           | Web App Onboarding           | urim      | P0       | Apr 1 | 14   | not-started |
| [feat-005](platform/feat-005-graphql-contract-stewardship.md) | GraphQL Contract Stewardship | tataihono | P0       | Apr 1 | 56   | not-started |
| [feat-006](platform/feat-006-code-review-unblocking.md)       | Code Review and Unblocking   | tataihono | P0       | Apr 1 | 56   | not-started |
| [feat-019](platform/feat-019-scaffolding-support-urim.md)     | Scaffolding Support for Urim | tataihono | P1       | Apr 7 | 21   | not-started |

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
- **topic-experiences**: Web/mobile experience rendering, Easter launch (feat-023 through feat-025, feat-029) + planned topic features (feat-001 through feat-003, feat-007, feat-008, feat-013, feat-015 through feat-018, feat-020, feat-021)
- **media-generation**: Video discovery dashboard, AI enrichment pipeline (feat-030, feat-031) + planned voiceover (feat-014)
- **platform**: CMS foundation, GraphQL pipeline, infrastructure, content sync, tooling, roadmap app (feat-022, feat-026 through feat-028, feat-032, feat-033) + planned onboarding, stewardship, review, scaffolding (feat-004 through feat-006, feat-019)
