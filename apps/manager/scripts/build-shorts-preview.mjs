import { build } from "esbuild"
await build({
  entryPoints: ["src/preview/client.tsx"],
  bundle: true,
  outfile: "public/shorts-preview/runtime.js",
  platform: "browser",
  format: "iife",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  target: "es2022",
})
