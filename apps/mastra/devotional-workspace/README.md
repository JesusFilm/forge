# Devotional Workspace

This directory is the seed manifest for the single Mastra Workspace used by the video-first devotional pipeline. In Railway, the writable S3-backed Workspace is authoritative. These checked-in files are migration inputs and contract fixtures, not a runtime fallback.

## Folder contract

All paths are below `/inputs` in the Workspace:

- `scripture/`: public-domain scripture source files.
- `reflections/`: reflection/source corpus files.
- `video/`: the JESUS-film catalog and chapter-to-passage map.
- `prompts/`: generation prompts, hook styles, and block arrangements.
- `safety/`: editable safety judge rubric. Code always enforces an immutable minimum confidence of `0.6`, fail-closed verdicts, and final structural checks.
- `calendar/`: fixed-date editorial calendar entries.
- `voices/`: provider voice aliases, synthesis settings, voice rotation, and visual-filter rotation.
- `music/`: mood prompts and default bed duration.
- `render/`: narration templates and validated composition filter/layout tokens.
- `brand/`: brand metadata and the editorial-rights assertion applied to authenticated writes.
- `media/`: text manifests that reference approved source media.

The singleton configuration paths are part of the runtime contract. Renaming one without changing and deploying business logic makes readiness fail:

```text
/inputs/prompts/generation.json
/inputs/safety/rubric.json
/inputs/calendar/holidays.json
/inputs/voices/profiles.json
/inputs/music/profiles.json
/inputs/render/styles.json
/inputs/render/narration.json
/inputs/brand/profile.json
/inputs/video/jesus-film-catalog.json
/inputs/video/jesus-film-passages.json
```

## Eligibility

Supported v1 text formats are UTF-8 `.md`, `.txt`, `.json`, `.yaml`, and `.yml`. Content-only files require no frontmatter. Their immediate parent folder defines their category. A supported file dropped into `scripture/` or `reflections/` becomes eligible when the next newly-created attempt reconciles the Workspace; no process restart or code change is required.

Unsupported extensions, invalid UTF-8, malformed singleton JSON, unsafe paths, and files that exceed inventory limits are excluded and reported. PDF, DOCX, and automatic binary media ingestion are not supported in v1. Studio file search may still show an unsupported stored file; that does not make it eligible for devotional retrieval.

## Editing and trust

Any authenticated Studio editor may create, replace, move, or delete Workspace inputs using Mastra's normal Workspace UI. There is no custom per-folder RBAC or approval flow. An authenticated placement is the editorial and usage-rights assertion. The audited filesystem records actor, request, timestamp, normalized path, pre/post digest, and the assertion.

Edits are live for the next newly-created attempt. A file changed after selection causes the current attempt to fail with `source-changed`; a retry reconciles and selects from the new catalog generation. Workflow code keeps only schemas, deterministic algorithms, provider boundaries, and immutable safety enforcement.

## Seeding and cutover

The migration copies these fixtures plus the owner-supplied scripture/reflection corpora into an immutable migration prefix, verifies SHA-256 digests, and commits readiness only after catalog validation and an independent backup/restore drill. Do not enable new devotional runs while required corpus files or singleton configuration are absent.
