# Studio top-bar experiments

Question: how can the editor header expose frequent editing actions without
giving occasional project, AI and delivery tools equal visual weight?

Source: `apps/manager/src/features/video-studio/editor.tsx`, header around
`nle-editor-header`; styles in `studio.css`. Exploration only; no editor changes.

## Functionality inventory

| Group              | Existing functionality                                 | Constraints for the experiments                                                                    |
| ------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Identity           | Document title; width × height; FPS                    | Keep title visible; details can move into project menu.                                            |
| Editing            | Undo; redo                                             | Preserve existing shortcuts and disabled states; retain discoverable controls.                     |
| Assets             | Add content                                            | Frequent action; opens the existing asset modal and pauses playback.                               |
| Project            | Settings                                               | Opens project configuration; no item selection required.                                           |
| Assistance         | Assistant                                              | Opens editor assistance, separate from script generation.                                          |
| Creation           | Generate scripts; speech and production                | Occasional preparation tools; group under Create or Prepare.                                       |
| Delivery           | Render and publish                                     | Keep prominent but distinct from editing; preserve existing workflow checks.                       |
| History            | Saved document revisions                               | Discoverable under project or save status; separate from local undo.                               |
| Persistence        | Autosave status/revision; Save; Retry save             | A compact Saved control can expose Save now and history.                                           |
| Exceptional states | Sign in required; conflict; failure; read-only project | Never hide behind a generic overflow menu; preserve current recovery actions and read-only gating. |

## Five alternatives

1. **Quiet editor:** one row. Project menu left; undo/redo and Add content near
   the work; Create menu and Assistant; compact save status; Publish at right.
   Default candidate: the smallest structural change, with visible editing tools.
2. **Two rows:** identity, save and delivery above; an editing toolbar below.
   Keeps labelled AI tools visible at the expense of vertical space.
3. **Workflow tabs:** Prepare / Edit / Deliver with a contextual toolbar.
   Makes creation and delivery stages explicit; moving between tools costs a tab.
4. **Menu bar:** Project / Edit / Insert / Create menus below a project strip.
   Familiar desktop hierarchy and good discoverability, with a second row.
5. **Command menu:** title, Add content and Publish dominate; other actions
   appear in a searchable command menu; undo/redo move to the timeline toolbar.
   Quietest header, but depends most on menu discovery.

## Prototype behavior

Five named variants share the same editor context and an inline carousel.
Project, Create, save and command menus can be opened; workflow tabs change their
contextual actions. All action outcomes are local previews. The design controls
allow metadata visibility, density and save-state comparison. Failed/conflict/
sign-in states remain visible in all variants. No persistence, media downloads,
backend requests or production UI changes. The user selected Two rows on 2026-10-21; feat-863 applies it to the real editor.

Inline source:
`/home/tataihono/.codex/visualizations/2026/10/19/01a15370-43c9-7081-8c25-f952be9b123a/studio-top-bar-experiments.html`.

## Decision

Use Two rows: project identity, save and delivery above; editing and creation
tools below. Format, history and manual save remain available in compact project
and save menus. Implementation is tracked in feat-863.
