---
id: "feat-003"
title: "Topic Content Type in Strapi"
owner: "nisal"
priority: "P0"
status: "cancelled"
start_date: "2026-04-01"
duration: 14
depends_on:
  - "feat-001"
blocks:
  - "feat-007"
  - "feat-013"
  - "feat-015"
  - "feat-016"
tags:
  - "cms"
  - "graphql"
---

## Entry Points — Read These First

1. `apps/cms/src/api/keyword/content-types/keyword/schema.json` — similar content type to follow as pattern
2. `apps/cms/src/api/experience/content-types/experience/schema.json` — Experience type that Topic links to
3. `apps/cms/src/api/video/content-types/video/schema.json` — Video type that Topic links to
4. `packages/graphql/codegen.ts` or `packages/graphql/package.json` — find the codegen command (search for `"codegen"` or `"generate"` script)
5. `apps/cms/schema.graphql` — current GraphQL schema, will be regenerated

## Grep These

- `collectionType` in `apps/cms/src/api/*/content-types/*/schema.json` — pattern for content type definitions
- `manyToMany` in `apps/cms/src/api/video/content-types/video/schema.json` — relation pattern for video <-> keyword
- `draftAndPublish` in `apps/cms/src/api/experience/` — how to enable publish workflow

## What To Build

1. New content type: `apps/cms/src/api/topic/content-types/topic/schema.json`

   ```json
   {
     "kind": "collectionType",
     "collectionName": "topics",
     "info": {
       "singularName": "topic",
       "pluralName": "topics",
       "displayName": "Topic"
     },
     "options": { "draftAndPublish": true },
     "attributes": {
       "name": { "type": "string", "required": true },
       "slug": { "type": "string", "unique": true, "required": true },
       "description": { "type": "text" },
       "source": {
         "type": "enumeration",
         "enum": ["ai", "editorial"],
         "default": "ai"
       },
       "videoCount": { "type": "integer", "default": 0 },
       "metaDescription": { "type": "text" },
       "parentTopic": {
         "type": "relation",
         "relation": "manyToOne",
         "target": "api::topic.topic",
         "inversedBy": "childTopics"
       },
       "childTopics": {
         "type": "relation",
         "relation": "oneToMany",
         "target": "api::topic.topic",
         "mappedBy": "parentTopic"
       },
       "videos": {
         "type": "relation",
         "relation": "manyToMany",
         "target": "api::video.video"
       },
       "experience": {
         "type": "relation",
         "relation": "oneToOne",
         "target": "api::experience.experience"
       },
       "keywords": {
         "type": "relation",
         "relation": "manyToMany",
         "target": "api::keyword.keyword"
       },
       "ogImage": {
         "type": "relation",
         "relation": "oneToOne",
         "target": "api::video-image.video-image"
       }
     }
   }
   ```

2. Create the required Strapi API files:
   - `apps/cms/src/api/topic/controllers/topic.ts`
   - `apps/cms/src/api/topic/services/topic.ts`
   - `apps/cms/src/api/topic/routes/topic.ts`
     Follow the exact pattern from `apps/cms/src/api/keyword/` — these are minimal Strapi boilerplate files.

3. Run Strapi locally to generate the GraphQL schema, then run codegen:

   ```bash
   cd apps/cms && pnpm dev          # starts Strapi, regenerates schema
   cd packages/graphql && pnpm codegen  # regenerates typed client
   ```

4. Grant public `find` and `findOne` permissions for the Topic type via Strapi admin (or bootstrap script if one exists — check `apps/cms/src/bootstrap.ts`).

## Constraints

- Do NOT add i18n to Topic yet. Keep it simple — single language for now.
- Do NOT add custom controllers beyond the Strapi defaults. Standard CRUD is enough.
- Schema field names must be camelCase in the JSON but Strapi converts to snake_case in the DB. Do not manually create DB columns.

## Verification

- Start Strapi: `cd apps/cms && pnpm dev` → no errors, Topic appears in admin sidebar
- Create a Topic via admin UI → saves successfully
- Query via GraphQL: `{ topics { name slug description videos { title } } }` → returns data
- Set parentTopic on a child → `childTopics` resolves on the parent
- Run codegen: `cd packages/graphql && pnpm codegen` → generates without errors
- Import the `graphql()` function in `apps/web` and write a topic query → TypeScript compiles
