# Semantic Search API — Agent Integration Guide

The JesusFilm Semantic Search API lets AI agents find video content by meaning, not just keywords. It combines vector similarity over scene-level embeddings with PostgreSQL full-text search, merged via Reciprocal Rank Fusion (RRF). Results include video-level display metadata plus optional scene timestamps and Mux playback IDs for deep-linking.

## Endpoints

### REST

```
GET https://cms.jesusfilm.org/api/search?q={query}&locale={locale}
```

### GraphQL

```graphql
query SemanticSearch(
  $query: String!
  $locale: String!
  $limit: Int
  $offset: Int
  $type: String
) {
  semanticSearch(
    query: $query
    locale: $locale
    limit: $limit
    offset: $offset
    type: $type
  ) {
    query
    hasMore
    searchMode
    results {
      type
      id
      slug
      title
      imageUrl
      snippet
      startSeconds
      playbackId
      score
    }
  }
}
```

**GraphQL endpoint:** `POST https://cms.jesusfilm.org/graphql`

Both endpoints are public — no authentication required.

## Parameters

| Parameter     | Required | Default | Description                                                                                                                                  |
| ------------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `q` / `query` | Yes      | —       | Natural language search query. Works with keywords, themes, felt needs, bible references, or full sentences. Max 200 characters recommended. |
| `locale`      | Yes      | —       | BCP-47 language code. Only returns content with a published variant in this language. Currently: `en`, `es`, `fr`.                           |
| `limit`       | No       | 20      | Results per page. Max 50.                                                                                                                    |
| `offset`      | No       | 0       | Pagination offset. Use with `hasMore` to page through results.                                                                               |
| `type`        | No       | both    | Filter by content type: `"video"` or `"experience"`. Omit to return both.                                                                    |

## Response Shape

```json
{
  "results": [
    {
      "type": "video",
      "id": 798,
      "slug": "easter-explained",
      "title": "Easter Explained",
      "imageUrl": "https://imagedelivery.net/.../f=jpg,w=1280,h=600,q=95",
      "snippet": "A short video explaining the meaning of Easter and the hope of new life.",
      "startSeconds": 0,
      "playbackId": "x3XKV1Yi01z7dyF6f8ZLBMNrHtNWS02iHoQw6vIcf4hBw",
      "score": 0.488
    }
  ],
  "hasMore": true,
  "query": "Easter",
  "searchMode": "hybrid"
}
```

### Field Reference

| Field          | Type                           | Description                                                                                                                                                                                                                                                                                  |
| -------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`         | `"video"` or `"experience"`    | Content type discriminator.                                                                                                                                                                                                                                                                  |
| `id`           | integer                        | Internal ID.                                                                                                                                                                                                                                                                                 |
| `slug`         | string                         | URL-safe identifier for linking.                                                                                                                                                                                                                                                             |
| `title`        | string                         | Display title.                                                                                                                                                                                                                                                                               |
| `imageUrl`     | string or null                 | Thumbnail URL. Null when no image is available.                                                                                                                                                                                                                                              |
| `snippet`      | string                         | For video results: localized video description or snippet for display. For experience results: meta description.                                                                                                                                                                             |
| `startSeconds` | number or null                 | Scene timestamp in seconds. Null for experience results and keyword-only video matches with no scene-level data. Use this to deep-link into a video at the matching moment.                                                                                                                  |
| `playbackId`   | string or null                 | Mux playback ID. Null for experiences or when no playable Mux-backed dub is available. Use to construct thumbnail URLs or playback URLs via Mux.                                                                                                                                             |
| `score`        | number (0-1)                   | RRF-normalized relevance score. Higher is better. Scores are relative within a result set, not absolute.                                                                                                                                                                                     |
| `hasMore`      | boolean                        | True when more results exist beyond the current page.                                                                                                                                                                                                                                        |
| `searchMode`   | `"hybrid"` or `"keyword-only"` | Which retrieval paths contributed. `"hybrid"` means semantic + keyword both ran (normal operation). `"keyword-only"` means the embedding service was unavailable and results are from keyword matching only — thematic and felt-need queries will return poor or empty results in this mode. |

## Writing Effective Queries

The search API understands natural language, not just keywords. The embedding model maps queries into the same vector space as the scene descriptions, which encode themes, felt needs, bible verses, narrative content, and emotional tone.

### What works well

**Felt needs and themes** — the strongest signal:

```
feeling alone in suffering
fear that I am not enough
dealing with grief after losing someone
searching for purpose and meaning in life
```

**Bible references and theological concepts:**

```
forgiveness
resurrection
sermon on the mount
prodigal son
```

**Descriptive scenes:**

```
centurion at the cross
Jesus healing the blind man
woman at the well
```

**Full sentences describing what you're looking for:**

```
I want to show someone who is skeptical about faith a video that addresses their doubts honestly
```

### What works less well

- **Single common words** like "God" or "Jesus" — too broad, matches everything
- **Internal identifiers** or technical terms the content doesn't contain
- **Queries in a language other than the indexed content language** — the embeddings are language-specific

## Pagination

Use `offset` and `hasMore` for cursor-less pagination:

```
# Page 1
GET /api/search?q=hope&locale=en&limit=10&offset=0

# Page 2 (only if hasMore was true)
GET /api/search?q=hope&locale=en&limit=10&offset=10
```

## Error Handling

| HTTP Status | Error Code (GraphQL `extensions.code`) | Meaning                                      | Action                                                               |
| ----------- | -------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------- |
| 200         | —                                      | Success. Check `searchMode` for degradation. | Parse results normally.                                              |
| 400         | `BAD_USER_INPUT`                       | Missing or invalid `q`, `locale`, or `type`. | Fix the request parameters.                                          |
| 429         | `RATE_LIMITED`                         | Too many requests from this IP.              | Wait `retryAfterSeconds` (included in the error response) and retry. |
| 503         | `SERVICE_UNAVAILABLE`                  | Search service is down.                      | Retry with exponential backoff.                                      |

### Degraded Mode Detection

When `searchMode` is `"keyword-only"`, the embedding service is temporarily unavailable. The API still returns results, but:

- Thematic/felt-need queries may return empty or irrelevant results
- Scene-level match timestamps (`startSeconds`) will be absent
- Only title/description keyword matches contribute to ranking

Agents should check `searchMode` and adjust behavior accordingly — e.g., fall back to broader keyword queries, or surface a notice that semantic search is temporarily limited.

## Health Probe

```
GET https://cms.jesusfilm.org/api/search/health
```

Returns the operational status of the embedding service:

```json
{
  "status": "ok",
  "error": null,
  "attempts": 142,
  "failures": 0,
  "lastErrorMessage": null,
  "lastErrorClass": null,
  "lastErrorAt": null
}
```

| `status`     | Meaning                                                              |
| ------------ | -------------------------------------------------------------------- |
| `"ok"`       | Embedding service is reachable. Semantic search is operational.      |
| `"degraded"` | Embedding service is unreachable. Search falls back to keyword-only. |

Rate limited to 5 requests per minute per IP.

## Rate Limits

- **Search endpoint:** 30 requests per minute per IP
- **Health endpoint:** 5 requests per minute per IP

Both are per-IP, applied by the application behind Cloudflare. Cloudflare WAF provides additional infrastructure-level protection.

## Constructing Video URLs

For video results with `playbackId` and `startSeconds`:

- **Thumbnail:** `https://image.mux.com/{playbackId}/thumbnail.jpg?time={startSeconds}`
- **Animated GIF:** `https://image.mux.com/{playbackId}/animated.gif?start={startSeconds}&end={startSeconds+5}`
- **Experience page:** `https://www.jesusfilm.org/{slug}/en` (web app, when available)

## Example: Agent Workflow

An AI agent helping a user find relevant video content:

```python
import requests

def search_videos(user_need: str, locale: str = "en") -> list:
    """Search JesusFilm videos by felt need or topic."""
    response = requests.get(
        "https://cms.jesusfilm.org/api/search",
        params={"q": user_need, "locale": locale, "limit": 5},
        timeout=10,
    )
    response.raise_for_status()
    data = response.json()

    if data["searchMode"] == "keyword-only":
        # Semantic search unavailable — results may be limited
        pass

    return [
        {
            "title": r["title"],
            "snippet": r["snippet"],
            "thumbnail": (
                f"https://image.mux.com/{r['playbackId']}/thumbnail.jpg?time={r['startSeconds']}"
                if r["playbackId"] and r["startSeconds"] is not None
                else r["imageUrl"]
            ),
            "relevance": r["score"],
        }
        for r in data["results"]
    ]

# Example: find content for someone dealing with fear
results = search_videos(
    "I feel paralyzed by fear and anxiety about the future"
)
```
