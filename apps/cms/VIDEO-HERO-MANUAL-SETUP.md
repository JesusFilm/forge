# Add a Video Hero block in Strapi

**Seed script:** To create the **Easter** experience with a Video Hero block (and an **Easter Hero** video if missing), run from the repo root:

```bash
pnpm --filter @forge/cms run seed
```

Or from `apps/cms`: `node scripts/seed-easter.cjs`. Requires `apps/cms/.env` (see DEV-COMMANDS.md).

To add or change Video Hero content manually, or to add a Video Hero to another experience, use the steps below.

## 1. Create a Video (required)

Video Hero has a required **Video** relation, so you need at least one Video:

1. **Content Manager** → **Video** → **Create new entry**
2. Set **Title** (e.g. `Easter Hero`)
3. **Slug** will auto-fill; leave or edit
4. **Image** (optional, e.g. poster/thumbnail)
5. **Save** and **Publish**

Note the entry (you’ll pick it in the next step).

## 2. Add a Video Hero block to an Experience

1. **Content Manager** → **Experience**
2. Open the experience (e.g. **Easter** or **Homepage**)
3. In the **blocks** dynamic zone, click **Add a component**
4. Choose **Video Hero**
5. Fill in:

| Field             | Value                                                                          |
| ----------------- | ------------------------------------------------------------------------------ |
| **Video**         | Select the Video you created (e.g. Easter Hero)                                |
| **Streaming URL** | `https://stream.mux.com/J3WBxqGgXxi01201FYmW0202ayeL7PGXfuuXR02nvjQCE7bI.m3u8` |
| **Heading**       | e.g. `Easter`                                                                  |
| **Subheading**    | e.g. `Easter 2025 — videos & resources about Lent, Holy Week, Resurrection`    |
| **CTA Label**     | optional, e.g. `Watch now`                                                     |
| **CTA Link**      | optional URL                                                                   |
| **Section key**   | optional, leave empty                                                          |

6. **Save** and **Publish** the Experience.

## 3. Check on the frontend

- For **Easter**: open `http://localhost:3000/watch/easter` (with the web app and CMS running).
- The hero should use the Mux URL above; heading/subheading/CTA come from the block.

## Video Hero component schema (reference)

Component: `sections.video-hero` (display name: **Video Hero**).

| Attribute    | Type     | Required | Notes                             |
| ------------ | -------- | -------- | --------------------------------- |
| sectionKey   | string   | No       | Optional key for layout/analytics |
| video        | relation | **Yes**  | manyToOne → `api::video.video`    |
| streamingUrl | string   | No       | HLS URL (e.g. Mux `.m3u8`)        |
| heading      | string   | No       | Main title                        |
| subheading   | text     | No       | Subtitle/description              |
| ctaLink      | string   | No       | Button URL                        |
| ctaLabel     | string   | No       | Button text                       |

The **streaming URL** is what the frontend uses for playback; the **video** relation is for metadata and is required by the schema.
