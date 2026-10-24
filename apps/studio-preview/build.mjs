import { build } from "esbuild"
await build({
  entryPoints: ["src/client.tsx"],
  bundle: true,
  outfile: "dist/client.js",
  platform: "browser",
  format: "iife",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  target: "es2022",
})
await build({
  entryPoints: ["src/server.ts"],
  bundle: true,
  outfile: "dist/server.mjs",
  platform: "node",
  format: "esm",
  target: "node22",
})
