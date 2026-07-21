---
name: forge-bulk-locale-factory
description: Use when creating, updating, validating, reviewing, or publishing translated Jesus Film Admin Experience locales through the JFP Admin MCP. Trigger for Bulk Locale Factory work, locale creation, missing locale discovery, Experience translation/adaptation, and target-language media replacement.
---

# Forge Bulk Locale Factory

Use the JFP Admin MCP as the source of truth. The AI runs the loop; Admin owns data, permissions, validation, writes, and publish.

## Workflow

1. Confirm source locale, target locale, and whether publish is allowed.
2. Use `experience.locale.missing` or `experience.list` to choose work.
3. Read the source with `experience.locale.read`.
4. Draft the target locale:
   - Translate user-facing copy.
   - Preserve block structure, IDs, Bible references, video IDs, asset IDs, and links unless a media check says to change them.
   - Keep slugs readable in the target language.
5. Run `experience.locale.validate`.
6. Check target-language media before writing when blocks contain video or media.
7. Use `experience.locale.create` or `experience.locale.update`.
8. Report what changed, warnings, and publish readiness.
9. Publish only when the user explicitly approves publish in this session and the MCP grants `experience:publish`.

## Media Rules

- Prefer target-language audio.
- Accept target-language subtitles when audio is unavailable and the source context allows it.
- If a video has no acceptable target-language version, search for a replacement.
- If no replacement fits, recommend hiding/removing that block instead of silently keeping broken content.

## Output

End every run with a short report:

- Created
- Updated
- Needs review
- Media warnings
- Published, if any
