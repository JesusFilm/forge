#!/usr/bin/env node
/**
 * Upserts an Experience in Strapi by slug (create if missing, update if exists).
 * Requires STRAPI_API_TOKEN and optionally STRAPI_URL (default http://localhost:1337).
 * Loads .env from repo root and apps/cms.
 *
 * Usage:
 *   node scripts/upsert-experience.js <slug> [locale] [payload.json]
 *   echo '{"slug":"home","isHomepage":true}' | node scripts/upsert-experience.js home en
 *
 * Payload: { slug, isHomepage?, sections? }. Sections: dynamic zone array of
 *   { __component: "sections.media-collection"|"sections.promo-banner"|"sections.info-blocks"|"sections.cta", ...attrs }
 */
const fs = require("fs");
const path = require("path");

function loadEnv(dir) {
  const f = path.join(dir, ".env");
  if (!fs.existsSync(f)) return;
  fs.readFileSync(f, "utf8")
    .split("\n")
    .forEach((line) => {
      const m = line.match(/^\s*(STRAPI_API_TOKEN|STRAPI_URL)\s*=\s*(.+)/);
      if (m)
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    });
}

const root = process.cwd();
loadEnv(root);
loadEnv(path.join(root, "apps", "cms"));

const token = process.env.STRAPI_API_TOKEN;
const baseUrl = (process.env.STRAPI_URL || "http://localhost:1337").replace(
  /\/$/,
  ""
);

if (!token || token === ".") {
  console.error("STRAPI_API_TOKEN is not set. Set it in .env or apps/cms/.env");
  process.exit(1);
}

const args = process.argv.slice(2);
const slug = args[0];
const locale = args[1] && !args[1].endsWith(".json") ? args[1] : "en";
const fileArg = args[1]?.endsWith(".json")
  ? args[1]
  : args[2]?.endsWith(".json")
    ? args[2]
    : null;

if (!slug) {
  console.error("Usage: node scripts/upsert-experience.js <slug> [locale] [payload.json]");
  process.exit(1);
}

let payload = { slug };
if (fileArg && fs.existsSync(fileArg)) {
  const raw = fs.readFileSync(fileArg, "utf8");
  payload = { ...payload, ...JSON.parse(raw) };
}

async function main() {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const listUrl = `${baseUrl}/api/experiences?filters[slug][$eq]=${encodeURIComponent(slug)}&locale=${encodeURIComponent(locale)}`;
  const listRes = await fetch(listUrl, { headers });
  if (!listRes.ok) {
    console.error("GET experiences failed:", listRes.status, await listRes.text());
    process.exit(1);
  }
  const listJson = await listRes.json();
  const existing = listJson.data ?? [];
  const documentId = existing[0]?.documentId;

  const body = { data: payload };

  if (documentId) {
    const putUrl = `${baseUrl}/api/experiences/${documentId}?locale=${encodeURIComponent(locale)}`;
    const putRes = await fetch(putUrl, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    });
    if (!putRes.ok) {
      console.error("PUT experience failed:", putRes.status, await putRes.text());
      process.exit(1);
    }
    const out = await putRes.json();
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  const postUrl = `${baseUrl}/api/experiences?locale=${encodeURIComponent(locale)}`;
  const postRes = await fetch(postUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!postRes.ok) {
    console.error("POST experience failed:", postRes.status, await postRes.text());
    process.exit(1);
  }
  const out = await postRes.json();
  console.log(JSON.stringify(out, null, 2));
}

main();
