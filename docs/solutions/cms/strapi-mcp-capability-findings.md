---
category: cms
date: 2026-03-30
topic: strapi-mcp-capability-findings
---

# Strapi MCP Server — Capability Findings

## Context

Tested the Strapi MCP server (`@anthropic/strapi-mcp-server`) for creating a full Christmas experience page with 10 block sections, 7 video documents, and nested dynamic zone content. The goal was to assess whether MCP can replace seed scripts and admin UI for content creation workflows.

## Capability Matrix

| Operation                 | Tool/Endpoint                          | Auth      | Result         | Notes                                                            |
| ------------------------- | -------------------------------------- | --------- | -------------- | ---------------------------------------------------------------- |
| List content types        | `strapi_get_content_types`             | API token | **Success**    | Returns all content type schemas                                 |
| List components           | `strapi_get_components`                | API token | **Success**    | Returns all component schemas                                    |
| Read via REST API         | `strapi_rest GET api/experiences`      | API token | **404**        | REST routes not exposed for custom content types                 |
| Read via content-manager  | `strapi_rest GET content-manager/...`  | API token | **401**        | Content-manager requires admin JWT, not API token                |
| Read via content-manager  | `strapi_rest GET content-manager/...`  | Admin JWT | **Success**    | Works after swapping `api_key` to admin JWT                      |
| Admin login               | `strapi_rest POST admin/login`         | None      | **Success**    | Returns fresh admin JWT (30-min expiry)                          |
| Create video              | `strapi_rest POST content-manager/...` | Admin JWT | **Success**    | 7 videos created successfully                                    |
| Create experience with DZ | `strapi_rest POST content-manager/...` | Admin JWT | **Success**    | 10 blocks, deeply nested dynamic zones                           |
| Publish content           | `strapi_rest POST .../actions/publish` | Admin JWT | **Success**    | Works on second call (first returned success but didn't persist) |
| Update experience         | `strapi_rest PUT content-manager/...`  | Admin JWT | **Success**    | Updated video relations on existing blocks                       |
| Upload media              | `strapi_upload_media`                  | API token | **Not tested** | Not needed for this use case                                     |

## Key Findings

### 1. API Token Cannot Access Content-Manager (Critical)

The MCP server uses the `api_key` from config as a Bearer token. Strapi's content-manager endpoints require admin JWT auth, not API token auth. This means MCP **cannot create or modify content** with its default API token configuration.

**Workaround:** Obtain an admin JWT via `POST admin/login` through MCP itself, then temporarily swap the `api_key` in the MCP config file to the admin JWT. The JWT expires every 30 minutes, so this must be refreshed for long sessions.

**Better fix needed:** The MCP server should support admin JWT auth natively, either by storing admin credentials or by auto-refreshing JWTs.

### 2. REST API Routes Not Exposed

Custom content types (experiences, videos) don't have REST API routes by default — they only have content-type schemas. Calling `GET api/experiences` returns 404. Only the content-manager admin API works.

This is a Strapi configuration issue, not an MCP issue. Routes could be exposed by adding route files to `apps/cms/src/api/experience/routes/`.

### 3. MCP Server Caches Auth Token at Startup

After editing the MCP config file to swap the API key, the MCP server continued using the old (expired) token. The config change was not picked up until the server was restarted. This forced us to use `curl` directly for content creation instead of the `strapi_rest` MCP tool.

### 4. Dynamic Zone Content Creation Works

The content-manager API successfully handles deeply nested dynamic zone payloads:

- Experience → blocks DZ (10 top-level blocks)
- Section → content DZ (video, container, bible quotes, quiz within each section)
- Container → slots → content DZ (text, advent-countdown, related-questions)

The `__component` key format (`sections.video-hero`) is required in payloads.

### 5. Relations Need Explicit Connect

Setting relations on components within dynamic zones requires the `connect` syntax:

```json
{ "video": { "connect": [{ "documentId": "..." }] } }
```

Simply passing a documentId string doesn't work. The Easter experience uses `{count: N}` format in read responses, but writes require `connect`/`disconnect` arrays.

### 6. Publish May Need Two Calls

The first publish call after creating content returned success but `publishedAt` remained null. A second identical publish call succeeded. This may be a timing issue or a Strapi v5 content-manager quirk.

## Practical Recommendations

1. **For content creation workflows:** Use admin JWT auth, not API tokens. The MCP server's default API token auth is only useful for reading schema metadata.

2. **For automated content pipelines:** Build a helper that auto-refreshes admin JWTs every 25 minutes (JWT expiry is 30 min). Or add admin credential support to the MCP server config.

3. **For testing MCP capabilities:** Swap the config's `api_key` to an admin JWT, but remember the MCP server caches it — restart the MCP server after config changes, or use `curl`/direct HTTP as a fallback.

4. **Content-manager API format:** Study existing content via `GET content-manager/collection-types/api::experience.experience/{documentId}` to understand the exact payload format before attempting writes. Dynamic zone formats are not well-documented.

## Content Created

| Item                     | Type       | documentId                 | Status    |
| ------------------------ | ---------- | -------------------------- | --------- |
| Christmas                | Experience | `qb5wsa0cv2ngv3t80692nvat` | Published |
| The Birth of Jesus       | Video      | `j42audfgmitdcav3edhvgrty` | Published |
| The Annunciation         | Video      | `u98dr0icmu67ria73rxmd4tg` | Published |
| The Magnificat           | Video      | `eg6jc1i6baojdk5363dvy76g` | Published |
| The Shepherds            | Video      | `p3zip8ctl9dlln20mhvolzi5` | Published |
| The Magi                 | Video      | `aob2thorq92n46aks0w1egce` | Published |
| God's Word Becomes Flesh | Video      | `jgtrlpdnl60d5vflavzx5mfa` | Published |
| Christmas Hero           | Video      | `zineyo7hun2ej1dwj1xwbz1w` | Published |
