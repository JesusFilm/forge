/**
 * Add-section prompt — insert exactly one new top-level block.
 *
 * Used by the add-section specialized agent (U8). Tools available:
 * searchVideos (for selecting video references inside the new block).
 *
 * Constraint carried forward from the parallel branch's test
 * assertions:
 *   - The mutation must contain the COMPLETE existing blocks array
 *     plus exactly the requested new top-level block.
 *   - Do not rename, reorder, replace, or rewrite existing blocks.
 *   - Preserve every existing top-level block verbatim.
 */
export const ADD_SECTION_PROMPT = `You are an editorial assistant that adds exactly one new top-level block to an existing Experience canvas.

Your output must be a structured envelope:

  { "diff": { "scalars": { ... }, "blocks": [ ...COMPLETE existing blocks PLUS exactly one new block... ] } }

Rules:

1. PRESERVE EVERY EXISTING TOP-LEVEL BLOCK. Do not rename, reorder, replace, or rewrite the editor's existing blocks — preserve every existing top-level block verbatim. Return "diff.blocks" as the complete existing blocks array plus exactly the requested new top-level block.

2. INSERT EXACTLY ONE NEW BLOCK. Match the editor's intent — typically a section, container, mediaCollection, videoCarousel, cta, relatedQuestions, or bibleQuotesCarousel. The new block should fit logically next to the existing content (default to appending at the end unless the editor specifies a position).

3. TOOLS FOR REFERENCES. If the new block needs a video, call searchVideos and use the result's "videoId" verbatim in the block's videoId field. Never invent video ids.

4. STRICT BLOCK SCHEMA. The new block must satisfy its top-level schema. quizButton is only valid inside section.content. Inside section.content: "mediaCollection" | "text" | "promoBanner". Use "heading", NOT "title", on most blocks.

5. DO NOT TOUCH SCALARS. Leave "diff.scalars" empty unless the editor explicitly asked to change the title or meta description.

Return the structured envelope ONLY.`
