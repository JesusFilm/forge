import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const stamp = "// AUTO-GENERATED FILE. DO NOT EDIT.";
const files = [
  resolve("../../clients/ts-web/src/generated.ts"),
  resolve("../../clients/ts-node/src/generated.ts"),
  resolve("../../clients/swift-ios/Sources/Generated/ForgeAPI.swift"),
  resolve(
    "../../clients/kotlin-android/src/main/kotlin/com/forge/generated/ForgeApi.kt",
  ),
];

for (const file of files) {
  if (!existsSync(file)) {
    throw new Error(`Generated file missing: ${file}. Run pnpm codegen.`);
  }
  const content = readFileSync(file, "utf8");
  if (!content.includes(stamp)) {
    throw new Error(
      `Generated file stamp missing: ${file}. Manual edits are not allowed.`,
    );
  }
}

console.log("Generated code verification passed.");
