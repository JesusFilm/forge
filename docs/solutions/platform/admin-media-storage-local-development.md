---
title: "Admin Media Storage Local Development"
category: platform
module: apps/admin
date: 2026-04-23
last_updated: 2026-05-03
problem_type: best_practice
component: service_object
severity: medium
applies_when:
  - "Adding or changing admin MediaAsset storage, previews, or downloads"
  - "Allowing service callers to register object keys directly"
  - "Serving local or S3-backed media through app routes"
tags:
  - admin
  - media-assets
  - storage
  - object-keys
  - local-development
---

# Admin Media Storage Local Development

`apps/admin` stores editorial media through `MediaAsset` records and a
backend-aware storage helper. The asset row is the editorial identity; object
keys, local paths, S3 buckets, and future Mux IDs are backend details.

## Default Local Mode

Local development and normal tests use the filesystem backend when
`RAILWAY_S3_BUCKET` is unset:

```text
apps/admin/.tmp/media-assets/media-assets/<asset-id>/<variant>/<filename>
```

This keeps development offline and avoids accidental production object writes.
The storage helper validates asset IDs, variants, filenames, and stored object
keys before any write or read. Do not join a database-provided object key onto
the local media directory until it has passed the same `media-assets/<asset-id>/<variant>/<filename>`
shape used by `mediaObjectKey`.

## Object Key Boundary

`MediaAsset.objectKey` and `MediaAsset.previewObjectKey` are storage
identifiers, not arbitrary paths. Service schemas should reject object keys
outside this shape:

```text
media-assets/<asset-id>/(original|preview)/<filename>
```

The storage read path should also validate the key before calling local
filesystem or S3 APIs. This prevents a bad row, unsafe service caller, or future
import path from turning the app route into a path traversal or unrelated bucket
object reader.

## Optional S3-Compatible Mode

For integration parity, run MinIO or LocalStack and point the existing Railway
S3 env vars at that endpoint. The admin app does not need a separate emulator
package for the common path.

```env
RAILWAY_S3_ENDPOINT=http://localhost:9000
RAILWAY_S3_BUCKET=forge-admin-local
RAILWAY_S3_ACCESS_KEY_ID=minioadmin
RAILWAY_S3_SECRET_ACCESS_KEY=minioadmin
RAILWAY_S3_REGION=us-east-1
```

Use this mode when validating S3-compatible behavior such as endpoint wiring,
credentials, bucket policy, or object reads through the API route.

## App Route Downloads

The API route should serve downloads with stable app URLs such as
`/api/media-assets/:id/download`, but response headers must not trust
`originalFilename` directly. Normalize the header filename with the same
filename sanitizer used for storage keys before setting `content-disposition`.

## Future Mux Mode

Mux is modeled as a media backend for video assets, but direct byte writes are
not supported locally. Future Mux work should add direct-upload creation,
webhook handling, and playback publication behind the same `MediaAsset` service
boundary. Local video development should keep using `LOCAL` or `S3` placeholder
assets unless Mux credentials are explicitly configured.

## Usage Discovery

`MediaAssetService.usage` scans `ExperienceLocale.ogImageUrl` and nested block
JSON on demand. It matches canonical asset-id fields and transitional URL or
object-key fields, returning structured JSON paths so editors and agents can
see where an asset is used before replacement or deletion.
