# Experience Editor Modules

The top-level `experience-editor.tsx` owns editor orchestration: locale state,
save/publish actions, selected block state, and cross-block drag state.

Keep new block-specific UI in this folder so agents can work on one block type
without loading the entire editor file. Prefer this shape:

- `*-card.tsx` for canvas cards and repeated nested item cards.
- `*.test.tsx` beside the component, using `renderToStaticMarkup` for stable
  markup/affordance tests when browser interaction is not required.
- Parent-owned mutations are passed as callbacks. Do not move save/publish or
  service calls into block presentation components.
- Keep block payload access defensive. Blocks are JSON-derived, so use local
  `asRecord` / `asString` style helpers or typed adapter functions before
  reading nested fields.

When extracting the next block, keep the public prop surface explicit and small:
the component should receive the block/item data, selected/drag state it needs,
and named callbacks for mutations.
