/**
 * Mastra CLI playground entry — eager `mastra` export for `mastra dev`.
 *
 * The Mastra CLI's bundler imports `{ mastra }` as a named export from
 * the entry file. Our production singleton at `src/mastra/index.ts`
 * deliberately drops that eager export to keep Next.js build-phase
 * imports from constructing agents before env is validated
 * (see the long comment block in that file).
 *
 * This file exists ONLY for `pnpm mastra:dev`. It is never imported by
 * Next.js routes or production code paths — the playground CLI runs
 * locally with env fully loaded, so eager construction is safe here.
 */
import { getMastra } from "../mastra"

export const mastra = getMastra()
