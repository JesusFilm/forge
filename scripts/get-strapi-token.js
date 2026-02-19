#!/usr/bin/env node
/**
 * Prints STRAPI_API_TOKEN from environment or .env files, or "." if unset.
 * Loads .env from repo root and apps/cms (no external deps).
 * Usage: node scripts/get-strapi-token.js
 */
const fs = require("fs");
const path = require("path");

function loadEnv(dir) {
  const f = path.join(dir, ".env");
  if (!fs.existsSync(f)) return;
  fs.readFileSync(f, "utf8")
    .split("\n")
    .forEach((line) => {
      const m = line.match(/^\s*STRAPI_API_TOKEN\s*=\s*(.+)/);
      if (m)
        process.env.STRAPI_API_TOKEN = m[1]
          .replace(/^["']|["']$/g, "")
          .trim();
    });
}

const root = process.cwd();
loadEnv(root);
loadEnv(path.join(root, "apps", "cms"));

const token = process.env.STRAPI_API_TOKEN || ".";
process.stdout.write(token);
if (process.stdout.isTTY) process.stdout.write("\n");
