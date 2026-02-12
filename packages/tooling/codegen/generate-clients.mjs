import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const stamp = "// AUTO-GENERATED FILE. DO NOT EDIT.";

const targets = [
  {
    path: resolve("../../clients/ts-web/src/generated.ts"),
    body: `${stamp}\nexport type ContentItem = { id: string; slug: string; locale: string; title: string; body: string; state: string };\nexport async function getContentItem(_locale: string, _slug: string): Promise<ContentItem | null> { return null; }\n`,
  },
  {
    path: resolve("../../clients/ts-node/src/generated.ts"),
    body: `${stamp}\nexport type ContentItem = { id: string; slug: string; locale: string; title: string; body: string; state: string };\n`,
  },
  {
    path: resolve("../../clients/swift-ios/Sources/Generated/ForgeAPI.swift"),
    body: `${stamp}\npublic struct ContentItem { public let id: String; public let slug: String; public let locale: String; public let title: String; public let body: String; public let state: String }\n`,
  },
  {
    path: resolve(
      "../../clients/kotlin-android/src/main/kotlin/com/forge/generated/ForgeApi.kt",
    ),
    body: `${stamp}\npackage com.forge.generated\n\ndata class ContentItem(val id: String, val slug: String, val locale: String, val title: String, val body: String, val state: String)\n`,
  },
];

for (const target of targets) {
  mkdirSync(dirname(target.path), { recursive: true });
  writeFileSync(target.path, target.body, "utf8");
}

console.log("Generated client stubs.");
